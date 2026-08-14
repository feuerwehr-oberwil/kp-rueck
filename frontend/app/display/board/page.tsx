"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { TokenBoard } from "./token-board"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useDisplaySearch } from "@/lib/contexts/display-search-context"
import { filterIncidents } from "@/lib/incident-search"
import { useGroups } from "@/lib/contexts/groups-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useCrossWindowSync } from "@/lib/hooks/use-cross-window-sync"
import { useDoubleBookedPersons } from "@/lib/hooks/use-double-booked-persons"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { CARD_VIEW_PRESETS } from "@/lib/card-view"
import { columns, ageLevel, COLUMN_HEADER_CLASS } from "@/lib/kanban-utils"
import { useCollapsedSections } from "@/lib/hooks/use-collapsed-sections"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import { DisplayIncidentCard } from "@/components/display/incident-card"
import { IncidentDetailModal } from "@/components/display/incident-detail-modal"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** Per-device fold state for the viewer board (see useCollapsedSections). */
const BOARD_COLLAPSE_KEY = "kp-display-board-collapsed"

export default function DisplayBoardPage() {
  const t = useTranslations('display')
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const { isAuthenticated } = useAuth()

  // Public share link (no login): render the read-only token board.
  if (token) {
    return <TokenBoard token={token} />
  }
  if (!isAuthenticated) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t('board.loginRequired')}
      </div>
    )
  }
  return <BoardDisplay />
}

function BoardDisplay() {
  const t = useTranslations('display')
  const tk = useTranslations('kanban')
  const { operations: allOperations, materialOnSite } = useOperations()
  const { materials, materialGroups } = useMaterials()
  const { selectedEvent } = useEvent()
  // The top bar's search, same predicate the command-post board filters with —
  // an address, a name, a Fahrzeug or a Material, across every column at once.
  const { query } = useDisplaySearch()
  const { groups, getGroupResources } = useGroups()
  // The wall always shows the WHOLE card, and deliberately does not follow the
  // operator's «Ansicht».
  //
  // It briefly did, on the theory that the wall should match the board on the
  // next monitor. But the two want opposite things: «Kompakt» exists so an
  // operator can fit more cards on a board they are working in, while a wall
  // exists to be read from across the room and has the room to spare. Worse,
  // the preset is per-device localStorage and there is no «Ansicht» control on
  // this page — so a wall PC left on «Kompakt» showed nothing but addresses,
  // and nobody standing at it could put that right.
  // One roster call for the whole board rather than one per card, exactly as
  // app/page.tsx threads it down.
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id)
  // groupId → Auftrag name: an incident is a stop on a route, and the route's
  // name lives on the group, not on the operation.
  const groupNames = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  )
  const operations = useMemo(
    () => filterIncidents(allOperations, query, materials, groupNames),
    [allOperations, query, materials, groupNames],
  )
  // Same conflict marking the board carries: a name on two incidents at once.
  const doubleBookedPersons = useDoubleBookedPersons(allOperations)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  // EVERY column folds now — a larger Feuerwehr otherwise just scrolls. All of
  // them start open except ABGESCHLOSSEN, which is finished work by definition
  // and whose width the live columns can use. Remembered per device.
  const collapsedColumns = useCollapsedSections(
    BOARD_COLLAPSE_KEY,
    columns.filter((c) => c.collapsible).map((c) => c.id),
  )

  // Track status changes for flash animation
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())
  const prevStatusRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const newFlashes = new Set<string>()
    const prevMap = prevStatusRef.current

    for (const op of operations) {
      const prevStatus = prevMap.get(op.id)
      // Flash if status changed (but not on initial load)
      if (prevStatus !== undefined && prevStatus !== op.status) {
        newFlashes.add(op.id)
      }
    }

    // Update prev map
    const nextMap = new Map<string, string>()
    for (const op of operations) nextMap.set(op.id, op.status)
    prevStatusRef.current = nextMap

    if (newFlashes.size > 0) {
      setFlashIds(newFlashes)
      // Clear flash after animation completes
      const timer = setTimeout(() => setFlashIds(new Set()), 2000)
      return () => clearTimeout(timer)
    }
  }, [operations])

  // Keep selected operation in sync with live data
  useEffect(() => {
    if (selectedOperation) {
      const updated = operations.find(op => op.id === selectedOperation.id)
      if (updated) setSelectedOperation(updated)
      else setSelectedOperation(null) // operation was deleted
    }
  }, [operations, selectedOperation?.id])

  // Folding a column changes its width by hundreds of pixels, which shoves every
  // column after it sideways. «Abgeschlossen» lives at the far right, so the
  // click that opens it widened something outside the scrollport and read as
  // "nothing happened" — and CLOSING moves the board just as far, so both
  // directions scroll the column back into view. Only on the click, never on
  // mount: a wall display may not yank itself sideways on its own.
  const keepInViewRef = useRef<string | null>(null)
  const requestKeepInView = (columnId: string) => { keepInViewRef.current = columnId }
  // A signature, because `useCollapsedSections` hands out a predicate rather than
  // the set: this string is what actually changes when a column folds, and it is
  // the only honest dependency for "the board has just re-laid out".
  const collapseSignature = columns.map((c) => (collapsedColumns.isCollapsed(c.id) ? "1" : "0")).join("")
  useEffect(() => {
    const columnId = keepInViewRef.current
    if (!columnId) return
    keepInViewRef.current = null
    // A DOM query rather than a ref: the folded strip and the open column are two
    // different elements, so the ref that survives the toggle is whichever one
    // just unmounted. `data-column` is on both.
    document
      .querySelector(`[data-column="${columnId}"]`)
      // `nearest`, not `end`: bring it back only as far as it takes to be
      // visible, so a column that never left the scrollport does not jump.
      ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" })
  }, [collapseSignature])

  useCrossWindowSync({
    onMessage: (msg) => {
      if (msg.type === "incident:selected") setHighlightedId(msg.incidentId)
    },
  })

  const operationsByColumn = useMemo(() => {
    const grouped: Record<string, Operation[]> = {}
    columns.forEach((col) => { grouped[col.id] = [] })
    operations.forEach((op) => {
      const column = columns.find((col) => col.status.includes(op.status))
      if (column) grouped[column.id].push(op)
    })
    return grouped
  }, [operations])

  return (
    // `overflow-x-auto` is a safety valve for a window narrower than any wall
    // (a laptop, a phone in landscape) — NOT the recovery path for a display.
    // Between 1280 and 1920 nothing may end up behind it: see the column
    // min-width below.
    <div className="flex h-full gap-2 p-3 overflow-x-auto">
      {/* The status-change flash, defined once for the board instead of once per
          card — the old copy shipped an identical <style> block inside every
          rendered card. */}
      <style>{`
        @keyframes display-card-flash {
          0%, 100% { box-shadow: none; }
          25% { box-shadow: 0 0 0 3px hsl(var(--primary) / 0.4); }
          50% { box-shadow: none; }
          75% { box-shadow: 0 0 0 3px hsl(var(--primary) / 0.4); }
        }
        .display-card-flash { animation: display-card-flash 1.5s ease-out; }
      `}</style>
      {columns.map((column) => {
        const ops = operationsByColumn[column.id] || []
        const isCollapsed = collapsedColumns.isCollapsed(column.id)
        // Something in here has sat past the board's own warning threshold. It
        // stays visible on the folded bar: a column that hides its overdue
        // incident behind a title is exactly what folding must not do.
        // The dot alone only says "something", which is the one thing an
        // operator can't act on — so it carries the names of the incidents that
        // tripped the threshold, up to three, on hover.
        const alarmOps = ops.filter((op) => ageLevel(op.statusChangedAt || op.dispatchTime) !== "normal")
        const hasAlarm = alarmOps.length > 0
        const alarmTitle = hasAlarm
          ? t('board.columnAlarmTitle', {
              count: alarmOps.length,
              titles: alarmOps.slice(0, 3).map((op) => getIncidentLocationLabel(op)).join(', ')
                + (alarmOps.length > 3 ? ` ${t('board.columnAlarmMore', { count: alarmOps.length - 3 })}` : ''),
            })
          : undefined

        // Collapsed: thin vertical toggle bar showing the count, reclaiming width.
        if (isCollapsed) {
          return (
            <button
              key={column.id}
              type="button"
              data-column={column.id}
              onClick={() => {
                requestKeepInView(column.id)
                collapsedColumns.toggle(column.id)
              }}
              className={cn(
                "flex w-12 flex-shrink-0 flex-col items-center gap-3 rounded-lg border border-border py-3 transition-colors hover:bg-foreground/5",
                column.color
              )}
              title={t('board.collapsedColumnTitle', { title: tk(`columns.${column.id}`), count: ops.length })}
            >
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="relative inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
                {ops.length}
                {hasAlarm && (
                  <span
                    title={alarmTitle}
                    aria-label={alarmTitle}
                    className="absolute -right-1 -top-1 h-2 w-2 cursor-help rounded-full bg-red-500 transition-[transform,box-shadow] hover:scale-150 hover:shadow-[0_0_0_3px_oklch(from_var(--color-red-500)_l_c_h/0.25)]"
                  />
                )}
              </span>
              <span className={cn(COLUMN_HEADER_CLASS, "[writing-mode:vertical-rl]")}>
                {tk(`columns.${column.id}`)}
              </span>
            </button>
          )
        }

        return (
          <div
            key={column.id}
            data-column={column.id}
            // 160px, not 280px. `flex-1` already hands every column an equal
            // share of whatever there is, so this floor only ever binds when
            // the share would be smaller — and at 280 it bound on every wall
            // under 1800px wide: seven columns needed 6×280 + 48 (the folded
            // strip) + gaps + padding, so at 1440 BEENDET/RÜCKFAHRT and
            // ABGESCHLOSSEN sat entirely off-screen and EINSATZ was cut. A wall
            // display has no pointer, so the scrollbar next to them was not a
            // way back to them.
            //
            // 160 is the tightest case that must still fit: 1280px with EVERY
            // column open (nobody has folded ABGESCHLOSSEN yet) leaves
            // (1280 − 24 padding − 48 gaps) / 7 ≈ 176px each. Below 1280 the
            // scroller takes over again, which is a laptop, where there is a
            // mouse.
            //
            // The cost is real and deliberate: at 1280 a card is ~176px wide
            // instead of 280 and its chips wrap onto more lines. A narrower
            // card read from across the room beats a column that is not on the
            // screen at all. At 1920 — the wall this surface is actually sized
            // for — the floor never binds and columns stay 300px, unchanged.
            className="flex flex-1 flex-col min-w-[160px] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => {
                requestKeepInView(column.id)
                collapsedColumns.toggle(column.id)
              }}
              aria-expanded
              className={cn(
                "mb-2 w-full cursor-pointer rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-foreground/5",
                column.color,
              )}
            >
              <div className="flex items-center gap-2">
                <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <h2 className={cn("flex-1 truncate", COLUMN_HEADER_CLASS)}>{tk(`columns.${column.id}`)}</h2>
                {hasAlarm && (
                  <span
                    title={alarmTitle}
                    aria-label={alarmTitle}
                    className="h-2 w-2 flex-shrink-0 cursor-help rounded-full bg-red-500 transition-[transform,box-shadow] hover:scale-150 hover:shadow-[0_0_0_3px_oklch(from_var(--color-red-500)_l_c_h/0.25)]"
                  />
                )}
                <span className="inline-flex items-center justify-center h-6 min-w-6 px-1.5 rounded-md bg-foreground/10 text-foreground text-xs font-bold tabular-nums">
                  {ops.length}
                </span>
              </div>
            </button>
            {/* space-y-3 and p-2, the column body the board uses: the cards are
                the board's cards now, so they get the board's rhythm too. */}
            <div className="flex-1 space-y-3 overflow-y-auto rounded-lg p-2">
              {ops.map((op) => {
                const auftrag = op.groupId ? groups.find((g) => g.id === op.groupId) : undefined
                return (
                  <DisplayIncidentCard
                    key={op.id}
                    operation={op}
                    cardView={CARD_VIEW_PRESETS.alles}
                    materials={materials}
                    materialGroups={materialGroups}
                    materialOnSite={materialOnSite}
                    vehicleDrivers={vehicleDrivers}
                    doubleBookedCrewNames={doubleBookedPersons.names}
                    auftrag={auftrag}
                    auftragResources={auftrag ? getGroupResources(auftrag.id) : null}
                    isHighlighted={highlightedId === op.id}
                    isFlashing={flashIds.has(op.id)}
                    onClick={() => setSelectedOperation(op)}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Logged in, so the report endpoints answer: the card opens the full
          picture — Reko-Bericht, Funkmeldungen and Verlauf included —
          read-only. Not every logged-in visitor gets all of it: the modal drops
          the Schadenplatz-Rapport for a viewer, because that endpoint is
          editor-gated over citizen PII. A session is permission to ask, not
          permission to read everything. */}
      <IncidentDetailModal
        operation={selectedOperation}
        open={!!selectedOperation}
        onOpenChange={(open) => { if (!open) setSelectedOperation(null) }}
        showReports
      />
    </div>
  )
}

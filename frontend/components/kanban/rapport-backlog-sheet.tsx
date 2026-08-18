"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { FileText, FileCheck, ChevronRight, CheckCircle2 } from "lucide-react"
import { SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { Badge } from "@/components/ui/badge"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { rapportApplies } from "@/lib/rapport-visibility"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { formatClockTime } from "@/lib/incident-time"
import { getTimeSince } from "@/lib/kanban-utils"
import type { Operation } from "@/lib/contexts/operations-context"

/**
 * One row of the sheet — a Schadenplatz and the state of its rapport. Carries
 * the whole `Operation` rather than a flattened copy so the row renders the
 * address exactly like every other surface does (`locationDisplay` first,
 * formatted fallback second).
 */
export interface OpenRapport {
  operation: Operation
  /** When the incident reached «Abgeschlossen» — the status transition, falling
   *  back to the alarm time on a card whose status never moved on the server.
   *  On an archived row whose Schadenplatz is still running it is the last
   *  status change, which the row words as «Stand» rather than «Abgeschlossen». */
  completedAt: Date
  /** A rapport row exists but was never filed. Reads very differently at 02:00
   *  from an untouched one, so the row says which. Always false on a filed one. */
  isDraft: boolean
}

/**
 * The backlog predicate — the ONE definition of "this rapport is still open".
 *
 * Three conditions, all required:
 *  1. the incident is closed (`complete`) — a running Schadenplatz is not late,
 *     the rapport simply is not due yet, and listing it would drown the ones
 *     that are;
 *  2. the rapport exists for this incident at all (`rapportApplies`, §18.27 —
 *     a Schadenplatz nobody was sent to has nothing to report on);
 *  3. nothing has been filed (`hasSchadenplatzRapport`) — a draft still counts
 *     as open, because a half-written form is not a rapport.
 *
 * Deliberately the same rule the card glyph uses in `draggable-operation.tsx`,
 * so the dimmed paper on a card and the count in the footer can never disagree.
 */
export function isOpenRapport(operation: Operation): boolean {
  if (operation.status !== "complete") return false
  if (operation.hasSchadenplatzRapport) return false
  return rapportApplies({
    hasBeenDispatched: operation.hasBeenDispatched,
    status: operation.status,
    hasReport: operation.hasSchadenplatzRapportDraft,
  })
}

/**
 * The backlog itself, oldest first — the point of the list is the rapport
 * everybody has stopped thinking about, so the forgotten one sits at the top.
 */
export function selectOpenRapports(operations: readonly Operation[]): OpenRapport[] {
  return operations
    .filter(isOpenRapport)
    .map((operation) => ({
      operation,
      completedAt: operation.statusChangedAt ?? operation.dispatchTime,
      isDraft: operation.hasSchadenplatzRapportDraft === true,
    }))
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime())
}

/**
 * The other half: a Schadenplatz-Rapport that HAS been filed.
 *
 * Deliberately the exact negation of condition 3 above and nothing else — no
 * status test. A crew that filed while the Schadenplatz was still running wrote
 * a rapport all the same, and the archive's job is to find what was written, not
 * to re-litigate when. A draft is not filed (it is still in «Offen»).
 */
export function isFiledRapport(operation: Operation): boolean {
  return operation.hasSchadenplatzRapport === true
}

/**
 * The archive, newest first — the mirror image of the backlog's ordering, and
 * for the mirror-image reason: nobody looks up the rapport they have forgotten,
 * they look up the one they just wrote.
 */
export function selectFiledRapports(operations: readonly Operation[]): OpenRapport[] {
  return operations
    .filter(isFiledRapport)
    .map((operation) => ({
      operation,
      completedAt: operation.statusChangedAt ?? operation.dispatchTime,
      isDraft: false,
    }))
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
}

interface RapportBacklogSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Already selected + sorted by `selectOpenRapports` — the page needs the same
   *  list for the footer count, so it is computed once up there. */
  rapports: readonly OpenRapport[]
  /** The already-filed ones, `selectFiledRapports`. Selected up in the page for
   *  the same reason: the sheet gets lists, never the whole board. */
  filed: readonly OpenRapport[]
  /** Opens the incident detail on its Rapport tab and closes this sheet. */
  onOpenRapport: (operationId: string) => void
}

type RapportTab = "open" | "filed"

/** One row, shared by both tabs — the archive is the same fact in the other
 *  state, so it must not drift into a second row design. */
function RapportRow({
  entry,
  filed,
  onOpen,
}: {
  entry: OpenRapport
  filed: boolean
  onOpen: (operationId: string) => void
}) {
  const t = useTranslations("kanban.dashboard.rapportBacklog")
  const { operation, completedAt, isDraft } = entry
  const address =
    (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity())) ||
    getIncidentTypeLabel(operation.incidentType)

  return (
    <button
      type="button"
      onClick={() => onOpen(operation.id)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left",
        "transition-colors hover:bg-muted/50",
      )}
    >
      {/* Same paper as the card chip: dimmed while it is missing, the ticked
          sheet in success green once it has been filed. */}
      {filed ? (
        <FileCheck className="size-4 shrink-0 text-success" />
      ) : (
        <FileText className="size-4 shrink-0 text-muted-foreground/40" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{address}</span>
          {isDraft && (
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-xs font-normal">
              {t("draft")}
            </Badge>
          )}
        </div>
        {/* The Einsatzleiter leads the line: the reason this row is opened at
            02:00 is «wen rufe ich dazu an», and that answer must not hide
            behind the incident type. Backed by the server's leader-of-record,
            so it survives the released assignments of a closed incident. */}
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {operation.leaderName && (
            <>
              <LeaderBadge isLeader />
              <span className="truncate font-medium text-foreground/90">{operation.leaderName}</span>
              <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">·</span>
            </>
          )}
          <span className="truncate">{getIncidentTypeLabel(operation.incidentType)}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        {/* «Abgeschlossen 10:45» would be a lie on an archived row whose
            Schadenplatz is still running — the crew filed early. Same
            timestamp, honest word. */}
        <div className="text-xs text-muted-foreground tabular-nums">
          {t(operation.status === "complete" ? "completedAt" : "changedAt", {
            time: formatClockTime(completedAt),
          })}
        </div>
        <div className="text-xs text-muted-foreground/70 tabular-nums">
          {t("since", { duration: getTimeSince(completedAt) })}
        </div>
      </div>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
    </button>
  )
}

/**
 * The Schadenplatz-Rapporte, in both states.
 *
 * «Offen» is deliberately a list you go to, not a prompt that comes to you:
 * closing an incident is a busy moment and an interrupting «jetzt ausfüllen?» at
 * exactly that moment is what gets answered with an empty form. The count sits
 * quietly in the footer until somebody has time.
 *
 * «Erfasst» is the other question the same operator asks — "what did we write
 * for that address last week" — and it belongs in the same place, because
 * hunting for it card by card is exactly the work this sheet exists to remove.
 * It is an archive, not a backlog: newest first, and it never touches the
 * footer's count, which keeps meaning «offen».
 */
export function RapportBacklogSheet({ open, onOpenChange, rapports, filed, onOpenRapport }: RapportBacklogSheetProps) {
  const t = useTranslations("kanban.dashboard.rapportBacklog")
  const [tab, setTab] = useState<RapportTab>("open")

  // Land on the tab that has something to say — with an empty backlog the sheet
  // was opened FOR the archive. Via a ref so that filing the last open rapport
  // while the sheet is on screen does not yank the tab out from under the
  // operator; only opening the sheet chooses.
  const hasOpenRef = useRef(rapports.length > 0)
  hasOpenRef.current = rapports.length > 0
  useEffect(() => {
    if (open) setTab(hasOpenRef.current ? "open" : "filed")
  }, [open])

  const entries = tab === "open" ? rapports : filed

  return (
    /* `gap-0` kills SheetContent's own 16px stack gap — the header is a single
       row here and every pixel above the first entry is a row the operator
       cannot see. */
    <FooterSheet
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col gap-0 max-w-3xl mx-auto px-6 pt-3 pb-4 modal-h-tall"
    >
      {/* Title and tabs share one line: the tab labels («Offen (3)» /
          «Erfasst (4)») already say which list is on screen, so the only thing
          left worth writing is the sort order — small, muted, next to the
          title, costing no vertical space at all. */}
      <SheetHeader className="flex-row items-center justify-between gap-4 p-0 shrink-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <SheetTitle className="text-base">{t("title")}</SheetTitle>
          <SheetDescription className="hidden truncate text-xs sm:block">
            {t(tab === "open" ? "description" : "descriptionFiled")}
          </SheetDescription>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as RapportTab)} className="shrink-0">
          <TabsList>
            <TabsTrigger value="open">{t("tabOpen", { count: rapports.length })}</TabsTrigger>
            <TabsTrigger value="filed">{t("tabFiled", { count: filed.length })}</TabsTrigger>
          </TabsList>
        </Tabs>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto mt-2.5 pb-2">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-28 text-center">
            <CheckCircle2 className="size-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">{t(tab === "open" ? "empty" : "emptyFiled")}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {entries.map((entry) => (
              <RapportRow
                key={entry.operation.id}
                entry={entry}
                filed={tab === "filed"}
                onOpen={onOpenRapport}
              />
            ))}
          </div>
        )}
      </div>
    </FooterSheet>
  )
}

"use client"

import { useEffect, useRef, useState, memo } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { RemovableChip } from "@/components/ui/removable-chip"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { FieldStatusNudge } from "@/components/kanban/field-status-nudge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Users, Package, Truck, Siren, AlertTriangle, ChevronUp, ChevronDown, Minus, Search, Binoculars, PenLine, Map, Building2, Printer, Timer, Footprints, MapPin, Undo2, Layers, Phone, Axe, CheckCircle2, ArrowRightLeft, Waypoints, FileText, FileCheck } from 'lucide-react'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { groupAssignedMaterials } from "@/lib/material-grouping"
import { rapportApplies } from "@/lib/rapport-visibility"
import { sortCrewByLeader } from "@/lib/crew-order"
import { useGroups } from "@/lib/contexts/groups-context"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { formatClockTime } from "@/lib/incident-time"
import { getIncidentLocationLabel, getIncidentTypeLabel } from "@/lib/incident-types"
import { PRIORITY_CARD_CLASSES, PRIORITY_ICON_CLASSES, type Priority } from "@/lib/priority"
import { DEFAULT_CARD_VIEW, cardViewEquals, type CardViewSettings } from "@/lib/card-view"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { telHref } from "@/lib/phone"
import { cn } from "@/lib/utils"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"

interface DraggableOperationProps {
  operation: Operation
  onRemoveCrew: (crewName: string) => void
  onRemoveMaterial: (materialId: string) => void
  onRemoveVehicle: (vehicleName: string) => void
  onToggleDriverStay?: (vehicleName: string) => void
  onRemoveReko?: () => void
  /** Open the detail as a modal (small screens). `tab`/`section` carry WHERE the
   *  click was aimed — see `openDetail` below; omitted for a click on the card
   *  as a whole, which lands on whichever tab the operator was last in. */
  onClick: (tab?: OperationDetailTab, section?: OperationDetailSection) => void
  /** Same intent, expressed as a selection for the side panel (large screens). */
  onSelect?: (tab?: OperationDetailTab, section?: OperationDetailSection) => void
  onHover: (opId: string | null) => void
  isHighlighted?: boolean
  isSelected?: boolean
  isKeyboardFocused?: boolean
  isDraggingRef: React.MutableRefObject<boolean>
  materials: Material[]
  index: number
  /** No longer read by the card — the heading uses `getIncidentLocationLabel`,
   *  which prefers the server's `location_display`. Still declared because the
   *  board and `droppable-column.tsx` thread it in; drop it there and here in
   *  one go. */
  formatLocation: (address: string) => string
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string) => void
  onAssignReko?: () => void
  onToggleNachbarhilfe?: () => void
  onToggleAmWarten?: () => void
  onToggleZuFuss?: () => void
  /** Editor-only: archive the incident (status → complete) directly from the card. */
  onRequestComplete?: () => void
  /** Editor-only: open the "Ressourcen übertragen" dialog for this incident. */
  onTransfer?: () => void
  /** Editor-only: open the Auftrag picker to distribute this incident into a route. */
  onDistributeToAuftrag?: () => void
  /** Which detail blocks this device shows. See lib/card-view.ts — the address,
   *  the priority marker and every warning/status chip are deliberately NOT in
   *  here. Pass a stable object: the memo comparator reads it field by field,
   *  but a fresh identity every render still costs nine comparisons per card. */
  cardView?: CardViewSettings
  printerEnabled?: boolean
  /** Vehicle name → driver, as the detail panel shows it. Threaded in from the
   *  board rather than fetched here: one roster call, not one per card. */
  vehicleDrivers?: ReadonlyMap<string, string>
  /** Names of crew members currently assigned to >1 incident — surface conflict styling. */
  doubleBookedCrewNames?: Set<string>
  /** False for viewers: don't register the drag source at all — a drag whose
   *  PATCH is guaranteed to 403 must not offer a working-looking affordance. */
  canDrag?: boolean
  /** Notifies the sync layer that a card drag started/ended so remote reloads
   *  queue for the duration (a mid-drag reload aborts the native drag). */
  onDragActiveChange?: (dragging: boolean) => void
}

// The boundary between the card's three sections — Kopf/Meldung, Ressourcen,
// Reko. Everything inside a section keeps the plain 12px rhythm; only these two
// boundaries get a rule, because Ressourcen and Reko are the two blocks that are
// genuinely a different kind of fact from the incident's own data.
//
// The rule belongs to whichever block OPENS a section, never to a wrapper: a
// section that renders nothing (Kompakt, a route stop whose resources live on
// the Auftrag, an incident without a Reko) then takes its rule with it and
// cannot leave an orphan line above nothing.
const SECTION_RULE = 'border-t pt-3'

/**
 * How many chips a resource row draws before it hands the rest to «+N weitere».
 *
 * A card is a magnet on a board, not a roster: the column is the scarce thing.
 * Measured on the real board — the card is 294–350px wide and a Swiss name chip
 * («Schneider Peter») is 92–118px, so a row holds two names, occasionally three.
 * Six is therefore three chip rows: the crew block keeps the same visual weight
 * as the Meldung above it, and the card stays in the size class of its
 * neighbours. Eight ran to four rows and made the resource block taller than the
 * whole rest of the card. Uncapped, 30 people produced a 771px card that pushed
 * every card under it off the screen.
 *
 * The same cap applies to the material row: it grows exactly the same way.
 */
const MAX_ROW_CHIPS = 6

/** Grey, underlined, never a colour — colour on this board means status. */
const MORE_LINK_CLASSES =
  'self-center text-xs text-muted-foreground underline underline-offset-2 decoration-muted-foreground/50 transition-colors hover:text-foreground hover:decoration-foreground cursor-pointer'

// Priority visual configuration — bold borders for quick scanning. The table
// itself lives in lib/priority.ts, which every surface that draws a priority
// now imports; the copy that used to sit here drifted from it (grey vs emerald
// low) and from the display card's copy of the copy.
// All cards always have border-l-4 to prevent layout shifts on hover/select.

function DraggableOperationBase({
  operation,
  onRemoveCrew,
  onRemoveMaterial,
  onRemoveVehicle,
  onToggleDriverStay,
  onRemoveReko,
  onClick,
  onSelect,
  onHover,
  isHighlighted,
  isSelected,
  isKeyboardFocused,
  isDraggingRef,
  materials,
  index,
  onAssignResource,
  onAssignReko,
  onToggleNachbarhilfe,
  onToggleAmWarten,
  onToggleZuFuss,
  onRequestComplete,
  onTransfer,
  onDistributeToAuftrag,
  cardView = DEFAULT_CARD_VIEW,
  printerEnabled,
  vehicleDrivers,
  doubleBookedCrewNames,
  canDrag = true,
  onDragActiveChange,
}: DraggableOperationProps) {
  const t = useTranslations('kanban')
  const tPrint = useTranslations('print.toasts')
  const tFeld = useTranslations('feld.board')
  const trackPrint = usePrintJobToast()
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)
  // `null` until the first measurement. Not `false`: the selection frame below
  // is gated on this, and a card that renders unstyled for one frame on a board
  // that does have the side panel is exactly the flicker we are avoiding. An
  // unmeasured card is therefore assumed to be on a large screen for STYLING
  // (server, hydration and first paint all agree), while the click handler keeps
  // treating "not yet measured" as small, which is what it always did.
  const [isLargeScreen, setIsLargeScreen] = useState<boolean | null>(null)
  const [isPrinting, setIsPrinting] = useState(false)
  const { materialGroups } = useMaterials()
  const { groups, getGroupResources } = useGroups()
  const { materialOnSite } = useOperations()

  // Auftrag (route) membership chip — opening the Aufträge sheet is signalled to
  // the page via a window event (mirrors the driver-assignment-changed pattern),
  // avoiding prop threading through the column/side-panel render trees.
  const auftrag = operation.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  const auftragTotal = auftrag ? auftrag.stopIds.length : 0
  // This incident's 1-based position in the route (e.g. "Stop 3/5"). Derive from
  // the resolved stop order; group_position (0-based) is the fallback if the id
  // isn't in stopIds yet (optimistic add mid-sync).
  const auftragStopIndex = auftrag ? auftrag.stopIds.indexOf(operation.id) : -1
  const auftragStopPos = auftrag ? (auftragStopIndex >= 0 ? auftragStopIndex + 1 : operation.groupPosition + 1) : 0
  // Grouped incidents carry no resources themselves — the route owns them. Read
  // the route's resource roll-up for the card chip summary.
  const auftragResources = auftrag ? getGroupResources(auftrag.id) : null
  const auftragSummary = auftragResources
    ? [
        auftragResources.vehicles.map((v) => v.name).join(', '),
        auftragResources.personnel.length ? t('card.auftragPersSummary', { count: auftragResources.personnel.length }) : '',
        auftragResources.materials.length ? t('card.auftragMatSummary', { count: auftragResources.materials.length }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  // What the row says, in full — the tooltip's job now that the row has two
  // lines that can each still truncate on a narrow column.
  const auftragTitle = auftrag
    ? [
        auftrag.name,
        t('card.auftragStopLine', { pos: auftragStopPos, total: auftragTotal }),
        auftragSummary,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  // What this device actually renders. Resolved once, up front, because the
  // resource block owns a `border-t` divider and its own padding: if the wrapper
  // stayed conditional on "has any resources" while the rows inside became
  // conditional on the view switches, a Kompakt card kept an empty bordered box.
  // A hidden block has to take its separator and its gap with it.
  const showRekoPerson = cardView.reko && !!operation.assignedReko
  const showCrewRow = cardView.mannschaft && !auftrag && operation.crew.length > 0
  const showVehicleRow = cardView.fahrzeuge && !auftrag && (operation.zuFuss || operation.vehicles.length > 0)
  const showMaterialRow = cardView.material && !auftrag && operation.materials.length > 0
  // Nachbarhilfe is a status, not a detail — it stays on every preset, same as
  // the header chips. Kompakt hides what you can look up; it does not hide who
  // else is on the address.
  const showNachbarhilfeRow = !!operation.nachbarhilfe
  const showResourceBlock =
    showRekoPerson || showCrewRow || showVehicleRow || showMaterialRow || showNachbarhilfeRow
  // How much of each resource row the counter is standing in for. Derived, not
  // props — `crew`/`materials` are already in the memo comparator.
  const hiddenCrewCount = showCrewRow ? Math.max(0, operation.crew.length - MAX_ROW_CHIPS) : 0
  const showMeldungBlock = cardView.meldung && !!operation.notes
  const showMelderBlock = cardView.melder && !!(operation.contact || operation.contactPhone)
  const showAuftragBlock = cardView.auftrag && !!auftrag
  const showRekoSummary = cardView.reko && !!operation.rekoSummary
  const melderTel = telHref(operation.contactPhone)

  // Selection is only worth showing while a side panel is on screen to reflect
  // it. Below SIDE_PANEL_BREAKPOINT the detail opens as a modal, so the frame
  // would just sit behind the overlay. `!== false` and not `=== true`: see the
  // note on the state — an unmeasured card keeps the frame.
  const showSelectionFrame = !!isSelected && isLargeScreen !== false

  /**
   * The card's ONE way into the detail — every target on the card goes through
   * here, so the drag guard and the panel/modal decision are written once.
   *
   * `tab`/`section` are what the operator pointed AT: the card is not a single
   * click target any more, it routes. A click on the Reko block opens the Reko
   * tab, a click on a crew/vehicle/material row opens Übersicht at its
   * Ressourcen block, and a click on anything else — the address, the Meldung,
   * the Melder, the card's background — carries no target at all and lands on
   * whichever tab that incident was last left in, exactly as before.
   *
   * The guard stays where it was: a click that merely ended a drag must not
   * navigate, and now that there are several targets it has to cover all of
   * them rather than the card's own handler alone.
   */
  const openDetail = (tab?: OperationDetailTab, section?: OperationDetailSection) => {
    if (isDraggingRef.current) return
    // Large screen: select for the sidebar, small screen: open the modal.
    if (isLargeScreen) {
      onSelect?.(tab, section)
    } else {
      onClick(tab, section)
    }
  }

  /** A click handler for one block of the card. It stops the event: the card's
   *  own handler is an ancestor and would otherwise fire straight afterwards
   *  and overwrite the block's target with the untargeted default. Chips,
   *  links and toggles inside a block stop the event themselves (see
   *  RemovableChip, IncidentTime, PickupBadge), so their own action still
   *  wins over the block's. */
  const openDetailFrom =
    (tab: OperationDetailTab, section?: OperationDetailSection) =>
    (event: React.MouseEvent) => {
      event.stopPropagation()
      openDetail(tab, section)
    }

  // Handle thermal print. The "gesendet" toast is now the START of the story —
  // trackPrintJob replaces it with what the printer actually did.
  const handlePrint = async () => {
    if (isPrinting) return
    setIsPrinting(true)
    try {
      const job = await apiClient.queueAssignmentPrint(operation.id)
      trackPrint(job.id, { sentTitle: t('common.printJobSent'), subject: tPrint('subjectSlip') })
    } catch (error) {
      console.error('Print failed:', error)
      toast.error(t('common.printFailed'))
    } finally {
      setIsPrinting(false)
    }
  }

  // Detect screen width for sidebar vs modal behavior
  useEffect(() => {
    const checkWidth = () => {
      setIsLargeScreen(window.innerWidth >= SIDE_PANEL_BREAKPOINT)
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // Get priority styling configuration
  const priority = (operation.priority || 'low') as Priority
  // The heading. `getIncidentLocationLabel` prefers the server's
  // `location_display` and only falls back to formatting the raw address here —
  // which is what the map, the wall board and every list already do. The card
  // used to run its own client-side formatter through a prop, so it missed the
  // address fixes the server had (c2f97d18) AND, because a prop the memo
  // comparator ignores cannot trigger a repaint, it kept a stale label until
  // something else repainted the card. `locationDisplay` is in the comparator.
  const locationLabel = getIncidentLocationLabel(operation)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    /** One place decides both hints, so they can never disagree: a card being
     *  reordered gets the edge line and no ring, anything else gets the ring
     *  and no line. */
    const setDropHint = (reorder: boolean, selfData: Record<string | symbol, unknown>) => {
      setIsOver(!reorder)
      setClosestEdge(reorder ? extractClosestEdge(selfData) : null)
    }

    return combine(
      ...(canDrag
        ? [
            draggable({
              element,
              getInitialData: () => ({ type: "operation", operation, index }),
              onDragStart: () => {
                setIsDragging(true)
                isDraggingRef.current = true
                onDragActiveChange?.(true)
              },
              onDrop: () => {
                setIsDragging(false)
                // Sync layer must know immediately — the click-suppression
                // delay below is only for the ref.
                onDragActiveChange?.(false)
                // Delay to prevent click from firing
                setTimeout(() => {
                  isDraggingRef.current = false
                }, 200)
              },
            }),
          ]
        : []),
      dropTargetForElements({
        element,
        canDrop: () => {
          // Can drop anything on operation cards
          return true
        },
        getData: ({ input }) => {
          return attachClosestEdge(
            { type: "operation-drop", operationId: operation.id, index },
            { element, input, allowedEdges: ['top', 'bottom'] }
          )
        },
        // Two drops, two different questions — and until now one answer.
        //
        // Dragging a CARD over a card asks "where in the column?", and the
        // closest-edge line is the right answer. Dragging a PERSON over a card
        // asks "does this card take him?", and the same line answered "insert
        // him between two cards", which is not a thing. It also pulled the aim
        // to the gap BETWEEN cards, so the drop landed on the column instead of
        // the card and looked like drag-and-drop was broken.
        //
        // So the edge line is now for card moves only, and a resource gets a
        // ring around the card it would land on.
        // Enter and move run the SAME body on purpose. An early return in
        // `onDrag` left whatever `onDragEnter` had put there, so a card that
        // never got a clean enter (the drag started on top of it, or the
        // pointer crossed in from a sibling) kept a stale reorder line under a
        // resource drag. Setting state to the value it already holds is a
        // no-op in React, so the repetition costs nothing.
        onDragEnter: ({ self, source }) => setDropHint(source.data.type === "operation", self.data),
        onDrag: ({ self, source }) => setDropHint(source.data.type === "operation", self.data),
        onDragLeave: () => {
          setIsOver(false)
          setClosestEdge(null)
        },
        onDrop: () => {
          setIsOver(false)
          setClosestEdge(null)
        },
      })
    )
  }, [operation, index, isDraggingRef, canDrag, onDragActiveChange])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* The shell carries the Spotlight dimming, not the card: the card's own
            `transition-all` belongs to its hover/selection states, and putting the
            opacity fade here keeps the two from fighting (see globals.css). */}
        <div className="operation-card-shell relative w-full">
          {closestEdge === 'top' && <DropIndicator edge="top" gap="4px" />}
          <Card
            ref={ref}
            style={{ opacity: isDragging ? 0.5 : 1 }}
            data-testid="incident-card"
            data-incident-id={operation.id}
            className={cn(
              // Hover is deliberately faint (/20): selection is expressed by the
              // frame below, so the background is left to say one thing only —
              // "the pointer is here". At /30 the two states looked the same.
              'operation-card border border-border border-l-4 bg-card/80 backdrop-blur-sm p-4 transition-all hover:bg-muted/20 cursor-pointer',
              // Priority styling. Kept while the card is selected AND while it is
              // hovered: selection is a neutral frame now and no longer borrows
              // the priority colours, and hover has no business overwriting them
              // either — a high-priority card that loses its red edge, wash and
              // pulse the moment the pointer crosses it is hiding the one thing
              // the operator is scanning for.
              !isHighlighted && PRIORITY_CARD_CLASSES[priority],
              // The card a dragged person/Gerät would land on. A ring OUTSIDE
              // the card (`ring-offset`) rather than a fill, so it reads as
              // "this whole card takes it" and stays visible on every priority
              // tint — the old `bg-muted/20` was invisible on all of them. Same
              // treatment the side panel's Ressourcen block uses.
              isOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background bg-primary/5',
              // "Hier steht sie" — the answer to a click in the sidebar. The old
              // treatment was bg-muted/30 plus a border tint, which was quieter
              // than the selected card right next to it and got lost on a board
              // full of cards. Now the card keeps its brightness while the rest of
              // the board steps back for a moment (Spotlight, see globals.css) and
              // carries an accent ring while it does. Priority still reads from the
              // chevron, so borrowing the left border for ~4s costs no information.
              isHighlighted && 'is-highlighted border-l-accent bg-muted/30 ring-[1.5px] ring-accent shadow-lg shadow-accent/25',
              // Selection: a full-strength neutral frame plus a neutral surface
              // tint — no colour of its own, so it can never compete with the red
              // a high-priority card already carries. Three deliberate choices:
              //
              // 1. OUTLINE, not ring/shadow. `priority-high-pulse` animates
              //    `box-shadow` outright (globals.css), which wipes out every
              //    box-shadow utility on the element — that is why the earlier
              //    ring-based selection was invisible on exactly the cards that
              //    matter most. An outline is a separate property, survives the
              //    animation, and is out of flow: 2px of extra frame, zero layout
              //    shift. At offset 0 it wraps OUTSIDE the border box, so the 4px
              //    priority edge stays fully visible inside it.
              // 2. The 1px border is taken to full `foreground` on top/right/bottom
              //    so no grey `border-border` line sits between the outline and the
              //    content. Bare `border-foreground` would clobber `border-l-*`
              //    (cn is twMerge), hence the three sides spelled out.
              // 3. The tint is a GRADIENT, not a `bg-*` colour: a background colour
              //    would twMerge away `bg-card/80` — and, on a high-priority card,
              //    its `bg-destructive` wash. A background image layers over
              //    whatever colour the card has. Keyed to `foreground`, so it
              //    darkens the light card and lightens the dark one with one value.
              //
              // Gated on `showSelectionFrame`, not on `isSelected`: on a screen
              // narrow enough that a click opens the modal instead of the side
              // panel there is nothing for the frame to point at. `isHighlighted`
              // (the notification Spotlight) is a different signal and stays at
              // every width.
              showSelectionFrame && !isHighlighted && 'border-t-foreground border-r-foreground border-b-foreground outline-2 outline-offset-0 outline-foreground bg-linear-to-b from-foreground/[0.06] to-foreground/[0.06]',
              // The hovered card is the one the keyboard shortcuts act on (the
              // board feeds `hoveredOperationId` in here), so it earns a cue of
              // its own — but NOT on the left edge, which belongs to priority.
              // Brightening the other three sides says "this one" without
              // overwriting anything, and stays out of the way of the selection
              // frame, which takes the same sides at full strength.
              isKeyboardFocused && !isHighlighted && !showSelectionFrame && 'border-t-muted-foreground/40 border-r-muted-foreground/40 border-b-muted-foreground/40'
            )}
            onMouseEnter={() => onHover(operation.id)}
            onMouseLeave={() => onHover(null)}
            // No target: the address, the Meldung, the Melder and the card's
            // own background all say «this incident» and nothing more precise.
            // The blocks that DO say something more precise stop the event
            // before it gets here — see `openDetailFrom`.
            onClick={() => openDetail()}
          >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            {/* Draggable area */}
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <div className="flex items-center flex-shrink-0 mt-0.5">
                {/* Priority indicator - icon only, no colors */}
                {priority === "high" ? (
                  <ChevronUp className={cn('h-4 w-4', PRIORITY_ICON_CLASSES[priority])} aria-label={t('card.priorityHighAria')} />
                ) : priority === "medium" ? (
                  <Minus className={cn('h-4 w-4', PRIORITY_ICON_CLASSES[priority])} aria-label={t('card.priorityMediumAria')} />
                ) : (
                  <ChevronDown className={cn('h-4 w-4', PRIORITY_ICON_CLASSES[priority])} aria-label={t('card.priorityLowAria')} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-base text-foreground leading-tight break-words">{locationLabel}</h3>
                {/* Abholung. Deliberately NOT gated on status: completing the
                    card auto-releases the crew while they are still standing at
                    the address, so this is the moment it matters most. */}
                {operation.pickupNeeded && (
                  <PickupBadge
                    requestedAt={operation.pickupRequestedAt}
                    note={operation.pickupNote}
                    incidentId={operation.id}
                    canEdit={canDrag}
                    className="mt-1.5"
                  />
                )}
              </div>
            </div>
            {/* Non-draggable icons area */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {operation.source === 'intake' && (
                <div
                  className="p-1.5 rounded-md bg-sky-100 dark:bg-sky-900/30"
                  title={t('card.intakeTooltip')}
                >
                  <Phone className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                </div>
              )}
              {/* Where the Meldung came from, as its own glyph: the phone desk
                  took a call, a Trupp stood in front of the thing. Both are
                  "somebody outside the KP said there is something here", and the
                  difference decides how much of it the operator re-checks — so
                  it is drawn, not left to the source field in the detail. */}
              {operation.source === 'feld' && (
                <div
                  className="p-1.5 rounded-md bg-violet-100 dark:bg-violet-900/30"
                  title={t('card.feldTooltip')}
                >
                  <Axe className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                </div>
              )}
              {operation.amWarten && (
                <div
                  className="p-1.5 rounded-md bg-amber-100 dark:bg-amber-900/30"
                  title={t('common.amWarten')}
                >
                  <Timer className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
              )}
              {operation.nachbarhilfe && (
                <div
                  className="p-1.5 rounded-md bg-muted/60"
                  title={t('common.nachbarhilfe')}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground/80" />
                </div>
              )}
              {/* Reko carries the Binoculars everywhere else in the app — a
                  second document glyph next to the Rapport's only invited the
                  operator to tell two near-identical papers apart.
                  A button, not a chip: it says a Reko-Bericht exists, so the
                  useful thing to do with it is read it — it opens the detail on
                  the Reko tab. Same faint hover as the map link beside it, which
                  is the card's established «this one is clickable» cue. */}
              {operation.hasCompletedReko && (
                <button
                  type="button"
                  onClick={openDetailFrom('reko')}
                  className="p-1.5 rounded-md bg-muted/60 transition-colors hover:bg-muted"
                  title={t('card.rekoDoneTooltip')}
                  aria-label={t('card.rekoDoneTooltip')}
                >
                  <Binoculars className="h-4 w-4 text-muted-foreground/80" />
                </button>
              )}
              {/* The Schadenplatz-Rapport, filed or missing. Filed = the TICKED
                  paper in success green — it lights up the same for a crew's
                  rapport and one typed in the KP, and it must, because a grey
                  FileText next to the grey Binoculars was unreadable as
                  "erledigt". Missing on a card that already reached `complete`
                  = the plain paper dimmed, so the gap is visible without a
                  dialog and without a block (decision 10 — a blocking gate is
                  a gate people defeat with empty forms). */}
              {/* Both states open the detail's Rapport tab: on a filed one
                  that is where it is read, and on a missing one that is where it
                  gets written — the gap is the reason to click. */}
              {operation.hasSchadenplatzRapport ? (
                <button
                  type="button"
                  onClick={openDetailFrom('rapport')}
                  className="p-1.5 rounded-md bg-success/10 transition-colors hover:bg-success/20"
                  title={tFeld('cardRapportTooltip')}
                  aria-label={tFeld('cardRapportTooltip')}
                >
                  <FileCheck className="h-4 w-4 text-success" />
                </button>
              ) : operation.status === 'complete' && rapportApplies({
                  hasBeenDispatched: operation.hasBeenDispatched,
                  status: operation.status,
                  hasReport: operation.hasSchadenplatzRapportDraft,
                }) ? (
                <button
                  type="button"
                  onClick={openDetailFrom('rapport')}
                  className="p-1.5 rounded-md bg-muted/40 transition-colors hover:bg-muted"
                  title={tFeld('cardNoRapportTooltip')}
                  aria-label={tFeld('cardNoRapportTooltip')}
                >
                  <FileText className="h-4 w-4 text-muted-foreground/40" />
                </button>
              ) : null}
              <Link
                href={`/map?highlight=${operation.id}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-md hover:bg-muted/80 transition-colors group/mapicon"
                title={t('card.showOnMap')}
              >
                <Map className="h-4 w-4 text-muted-foreground group-hover/mapicon:text-foreground transition-colors" />
              </Link>
            </div>
          </div>

          {/* Einsatzart and time share one line: they are both single short facts,
              and two stacked rows cost a card's worth of height on a full board.
              The label truncates rather than wraps so it can never push the time
              off the row. Each half is independently toggleable (see lib/card-view.ts),
              so the pair only shares a row when both are switched on — with the time
              alone the row keeps its original full-width split.
              Label and time share the chip's type scale (text-xs, 3.5 icon) so the
              row reads as one line rather than a big label with a small number
              stuck to it — most Einsatzarten are long enough («Elementarereignis»)
              that the label is truncating anyway, and the address above is what
              carries the card.
              The chip carries the age colouring (amber/red once it has sat too long),
              which is a separate signal from whichever number the mode shows —
              see components/ui/incident-time.tsx. */}
          {cardView.einsatzart && cardView.zeiten ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <Siren className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="truncate text-xs text-muted-foreground">{getIncidentTypeLabel(operation.incidentType)}</span>
              </div>
              <IncidentTimeRow operation={operation} colorByAge className="flex-shrink-0" />
            </div>
          ) : cardView.einsatzart ? (
            <div className="flex items-center gap-1.5">
              <Siren className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate text-xs text-muted-foreground">{getIncidentTypeLabel(operation.incidentType)}</span>
            </div>
          ) : cardView.zeiten ? (
            <IncidentTimeRow operation={operation} colorByAge className="justify-between" />
          ) : null}

          {/* What the field reported, as a question instead of a second status
              display. Rendered conditionally so only the handful of cards that
              actually have a field report subscribe to the operations context —
              the card body itself stays behind its memo. */}
          {(operation.fieldCompleteReportedAt || operation.fieldArrivedAt) && (
            <FieldStatusNudge operation={operation} canEdit={canDrag} />
          )}

          {/* Meldung (notes) — what came in on the phone. Still part of the first
              section: everything down to the Melder is the incident's own data,
              12px apart and with no rule between any two of them. The card used
              to fence off every single block, which read as a hierarchy the
              content does not have; the two rules it kept (see SECTION_RULE)
              mark the only real change of subject. */}
          {showMeldungBlock && (
            <div>
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                {operation.notes}
              </p>
            </div>
          )}

          {/* Melder — who called, and the number to call back. Off in Standard
              because the card never showed it; on in Alles, where an operator
              working the phones wants to reach the address without opening the
              incident first. */}
          {showMelderBlock && (
            <div className="flex items-start gap-1.5 text-xs">
              {/* Name and number can wrap, so the glyph stays top-aligned and is
                  nudged onto the middle of the FIRST line: (16px line − 14px
                  icon) / 2 = 1px. Same rule for every plain-text row below. */}
              <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-px" />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                {operation.contact && (
                  <span className="text-muted-foreground break-words">{operation.contact}</span>
                )}
                {operation.contactPhone && (
                  melderTel ? (
                    <a
                      href={melderTel}
                      onClick={(e) => e.stopPropagation()}
                      className="tabular-nums text-foreground/80 hover:text-foreground hover:underline"
                      title={t('common.callContact')}
                    >
                      {operation.contactPhone}
                    </a>
                  ) : (
                    <span className="tabular-nums text-muted-foreground">{operation.contactPhone}</span>
                  )
                )}
              </div>
            </div>
          )}

          {/* RESSOURCEN — section two, opened by the rule. Who and what is on
              this address, as opposed to the incident's own data above.
              For grouped incidents the per-incident crew/vehicle/material rows
              are suppressed (the route owns those, summarised in the Auftrag row
              below), so this block — and its rule — only renders when something
              inside it will actually show; otherwise it left an orphan line.
              Clicking anywhere in here opens Übersicht at its Ressourcen block:
              who and what is on the address is one question, and the detail
              answers it in one place. */}
          {showResourceBlock && (
            <div
              className={cn(SECTION_RULE, "space-y-3 text-xs")}
              onClick={openDetailFrom('overview', 'resources')}
            >
              {/* Assigned Reko Person — rides the "Reko" switch, not "Mannschaft":
                  one label, one concept, so turning Reko off really does take the
                  whole reconnaissance off the card. */}
              {showRekoPerson && operation.assignedReko && (
                // The one row in this block that is NOT a Ressource in the
                // Übersicht sense: who is out looking, and every control for
                // changing that, now lives on the Reko tab. So it overrides its
                // parent's target instead of inheriting it.
                <div className="flex items-start gap-1.5" onClick={openDetailFrom('reko')}>
                  <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    {/* `min-w-0 max-w-full shrink` overrides the Badge base's
                        `shrink-0` (twMerge) so a lone chip SHRINKS and truncates
                        its text instead of forcing the row onto a second line;
                        the remove X keeps `shrink-0` so it never disappears.
                        Same treatment on every chip row of this card. */}
                    <RemovableChip
                      variant="secondary"
                      className="min-w-0 max-w-full shrink text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 hover:bg-destructive/10 cursor-default"
                      onRemove={() => onRemoveReko?.()}
                      removeTitle={t('common.removeNamed', { name: operation.assignedReko.name })}
                      removeButtonClassName="shrink-0 hover:text-destructive cursor-pointer"
                      removeIconClassName="h-2.5 w-2.5"
                    >
                      {/* Never an empty chip: a name the roster lost renders as
                          «Unbekannt», not as a blank pill. */}
                      <span className="truncate">{operation.assignedReko.name.trim() || t('common.unknownResource')}</span>
                    </RemovableChip>
                    {/* Show arrival time if on site but report not yet submitted */}
                    {operation.rekoArrivedAt && !operation.hasCompletedReko && (
                      <span className="text-xs text-muted-foreground">
                        {t('card.onSiteSince', { time: formatClockTime(operation.rekoArrivedAt) })}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {showCrewRow && (
                <div className="flex items-start gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {/* EL first (decision 23): on a card that clips its crew line,
                        the one name worth reading is the Einsatzleiter's. */}
                    {sortCrewByLeader(operation.crew, operation.leaderName).slice(0, MAX_ROW_CHIPS).map((crewName) => {
                      const isConflict = doubleBookedCrewNames?.has(crewName) ?? false
                      return (
                        <RemovableChip
                          key={crewName}
                          variant="secondary"
                          className={cn(
                            "min-w-0 max-w-full shrink text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 hover:bg-destructive/10 cursor-default",
                            isConflict && "border border-warning/60 text-warning-foreground bg-warning/10",
                          )}
                          title={
                            isConflict
                              ? t('card.doubleBookedTooltip', { name: crewName })
                              : undefined
                          }
                          onRemove={() => onRemoveCrew(crewName)}
                          removeTitle={t('common.removeNamed', { name: crewName })}
                          removeButtonClassName="shrink-0 hover:text-destructive cursor-pointer"
                          removeIconClassName="h-2.5 w-2.5"
                        >
                          {/* Leading chip glyphs are h-3 throughout the card (the
                              chip's own remove X stays at 2.5) and never shrink,
                              so a long name cannot squash them. */}
                          {isConflict && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
                          {/* Read-only here: the card is a drag source, and the
                              star only renders for whoever actually holds the
                              role, so the chip row stays as dense as it was. */}
                          <LeaderBadge isLeader={operation.leaderName === crewName} />
                          <span className="truncate">{crewName.trim() || t('common.unknownResource')}</span>
                        </RemovableChip>
                      )
                    })}
                    {hiddenCrewCount > 0 && (
                      /* The rest of the Mannschaft, as one affordance instead of
                         twenty more chips. It opens the detail's Ressourcen
                         block, which is where the full list — and every control
                         for changing it — already lives. */
                      <button
                        type="button"
                        onClick={openDetailFrom('overview', 'resources')}
                        className={MORE_LINK_CLASSES}
                        title={t('card.moreCrewTitle', { count: hiddenCrewCount })}
                      >
                        {t('card.moreCount', { count: hiddenCrewCount })}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {showVehicleRow && (
                <div className="flex items-start gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {operation.zuFuss && (
                      <RemovableChip
                        variant="secondary"
                        className="min-w-0 max-w-full shrink text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 hover:bg-destructive/10 cursor-default"
                        onRemove={() => onToggleZuFuss?.()}
                        removeTitle={t('common.removeZuFuss')}
                        removeButtonClassName="shrink-0 hover:text-destructive cursor-pointer"
                        removeIconClassName="h-2.5 w-2.5"
                      >
                        <Footprints className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{t('common.zuFuss')}</span>
                      </RemovableChip>
                    )}
                    {operation.vehicles.map((vehicleName) => {
                      const callsign = operation.vehicleCallsigns.get(vehicleName)
                      const driverStay = operation.vehicleDriverStay?.get(vehicleName)
                      // Who is driving it, on the card itself — the same
                      // «Name · Funkrufname (Fahrer)» line the detail shows. Who
                      // sits behind the wheel is a radio question, and answering
                      // it should not need the card opened.
                      const driverName = vehicleDrivers?.get(vehicleName)
                      return (
                      <RemovableChip
                        key={vehicleName}
                        variant="secondary"
                        className="min-w-0 max-w-full shrink text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 cursor-default"
                        title={callsign ? t('common.funkrufname', { callsign }) : undefined}
                        onRemove={() => onRemoveVehicle(vehicleName)}
                        removeTitle={t('common.removeNamed', { name: vehicleName })}
                        removeButtonClassName="shrink-0 hover:text-destructive cursor-pointer"
                        removeIconClassName="h-2.5 w-2.5"
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleDriverStay?.(vehicleName)
                          }}
                          // min-w-0 so the NAME truncates while the status pill
                          // (shrink-0 below) stays whole — a long
                          // «Name · Funkrufname (Fahrer)» must never wrap the
                          // chip onto a second line.
                          className="flex min-w-0 items-center gap-1 cursor-pointer"
                          title={driverStay ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
                        >
                          <span className="truncate">
                            {vehicleName}{callsign ? ` · ${callsign}` : ''}
                            {driverName && (
                              <span className="text-muted-foreground"> ({driverName})</span>
                            )}
                          </span>
                          {/* Short form on the card — «vor Ort» / «zurück» —
                              because a Kanban column holds three of these chips
                              side by side. The full sentence is on the surfaces
                              that have the room: the assign dialog, the wall and
                              the phone. What it is NOT any more is two 12px
                              glyphs at different opacities. */}
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-2xs font-semibold leading-4",
                              driverStay
                                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                : "bg-muted-foreground/15 text-muted-foreground",
                            )}
                          >
                            {driverStay ? <MapPin className="h-2.5 w-2.5 shrink-0" /> : <Undo2 className="h-2.5 w-2.5 shrink-0" />}
                            {driverStay ? t('common.driverStays') : t('common.driverReturns')}
                          </span>
                        </button>
                      </RemovableChip>
                      )
                    })}
                  </div>
                </div>
              )}
              {showMaterialRow && (
                <div className="flex items-start gap-1.5">
                  <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                  <div className="flex flex-wrap gap-1 min-w-0">
                    {(() => {
                      const { completeGroups, ungrouped } = groupAssignedMaterials(operation.materials, materials, materialGroups)
                      // Same cap, same reason as the crew row above: a Modul plus
                      // a dozen loose Geräte grew the card without bound. Groups
                      // are counted first because they are the denser statement —
                      // one chip that stands for a whole module.
                      const shownGroups = completeGroups.slice(0, MAX_ROW_CHIPS)
                      const shownUngrouped = ungrouped.slice(0, Math.max(0, MAX_ROW_CHIPS - shownGroups.length))
                      const hiddenMaterialCount =
                        completeGroups.length - shownGroups.length + ungrouped.length - shownUngrouped.length
                      return (
                        <>
                          {/* Complete groups shown as single group badge */}
                          {shownGroups.map(({ group, materialIds: matIds }) => (
                            <RemovableChip
                              key={`group-${group.id}`}
                              variant="secondary"
                              className="min-w-0 max-w-full shrink text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 hover:bg-destructive/10 cursor-default"
                              onRemove={() => matIds.forEach((matId) => onRemoveMaterial(matId))}
                              removeTitle={t('common.removeNamed', { name: group.name })}
                              removeButtonClassName="shrink-0 hover:text-destructive cursor-pointer"
                              removeIconClassName="h-2.5 w-2.5"
                            >
                              <Layers className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                              <span className="truncate">{group.name}</span>
                            </RemovableChip>
                          ))}
                          {/* Ungrouped materials shown individually */}
                          {shownUngrouped.map((materialId, idx) => {
                            const material = materials.find(m => m.id === materialId)
                            // Left standing at this address by the crew's rapport.
                            // Marked on the card as well as in the sidebar: the
                            // card is where an operator decides what still has to
                            // happen here, and "die Pumpe läuft noch" is one of
                            // the things that still has to happen.
                            const onSite = materialOnSite.has(materialId)
                            return (
                              <RemovableChip
                                key={idx}
                                variant="secondary"
                                className={cn(
                                  "min-w-0 max-w-full shrink text-xs px-1.5 py-0.5 font-normal flex items-center gap-1 hover:bg-destructive/10 cursor-default",
                                  onSite && "bg-warning/15 text-warning-foreground",
                                )}
                                onRemove={() => onRemoveMaterial(materialId)}
                                removeTitle={t('common.removeNamed', { name: material?.name || materialId })}
                                removeButtonClassName="shrink-0 hover:text-destructive cursor-pointer"
                                removeIconClassName="h-2.5 w-2.5"
                              >
                                {onSite && <MapPin className="h-3 w-3 flex-shrink-0" />}
                                <span className="truncate">{material?.name || materialId}</span>
                              </RemovableChip>
                            )
                          })}
                          {hiddenMaterialCount > 0 && (
                            <button
                              type="button"
                              onClick={openDetailFrom('overview', 'resources')}
                              className={MORE_LINK_CLASSES}
                              title={t('card.moreMaterialTitle', { count: hiddenMaterialCount })}
                            >
                              {t('card.moreCount', { count: hiddenMaterialCount })}
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}
              {showNachbarhilfeRow && (
                <div className="flex items-start gap-1.5">
                  {/* Plain text, not chips: mt-1 is the chip offset and left the
                      glyph sitting off-centre against the word. 1px centres it on
                      the first line and keeps a wrapped note top-aligned. */}
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-px" />
                  <div className="flex flex-wrap items-center gap-1 min-w-0">
                    <span className="text-muted-foreground break-words">
                      {operation.nachbarhilfeNote || t('common.nachbarhilfe')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Auftrag (route) membership — rendered as a labelled resource-style row
              (matching the crew/vehicle/material rows above) rather than a floating
              pill. Resources live on the route, so the row carries the route name,
              its done/total progress, and the route's resource roll-up. The whole
              row opens the Aufträge sheet — deliberately NOT the incident detail,
              even now that the card's other blocks route into it: a grouped
              stop's crew, vehicles and material are owned and edited by the
              route, and the detail can only show them read-through.
              Part of the Ressourcen section, not a fourth one: the route is where
              this stop's crew, vehicles and material actually are. It therefore
              carries the section's rule only when it OPENS the section, i.e. when
              the resource block above it rendered nothing. */}
          {showAuftragBlock && auftrag && (
            <div className={cn("text-xs", !showResourceBlock && SECTION_RULE)}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  window.dispatchEvent(new CustomEvent('kp:open-auftraege', { detail: { groupId: auftrag.id } }))
                }}
                className="group/auftrag flex w-full min-w-0 items-start gap-1.5 text-left transition-colors"
                // The whole row, not just the name: this attribute used to carry
                // the Auftrag NAME while the row rendered «Pio · 3 …», so the
                // one thing that was actually cut off was the one thing the
                // tooltip could not give back.
                title={auftragTitle}
              >
                <Waypoints className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0 mt-1"
                  style={{ backgroundColor: auftrag.color ?? 'var(--muted-foreground)' }}
                />
                {/* Two lines, because one never fit: measured, the single row
                    asked for 107px of content in 49px of space (19px on the wall
                    at 1280) and rendered «Pio · 3 …». The name gets the first
                    line to itself and the progress sits under it. The card grows
                    by one line — but only on a card that is a route stop at all. */}
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate font-medium text-foreground/80 group-hover/auftrag:text-foreground transition-colors">
                    {auftrag.name}
                  </span>
                  <span className="truncate text-2xs text-muted-foreground">
                    <span className="tabular-nums">{t('card.auftragStopLine', { pos: auftragStopPos, total: auftragTotal })}</span>
                    {auftragSummary && <> · {auftragSummary}</>}
                  </span>
                </span>
              </button>
            </div>
          )}

          {/* REKO — section three, and the reason the card has rules at all: what
              somebody went and looked at is a different kind of statement from
              everything above it. Its own switch, not the Meldung's (§18.12), so
              the rule disappears with the block on a card without a Reko. */}
          {showRekoSummary && operation.rekoSummary && (
            // What the Reko found — so the block opens the Reko tab, which is
            // where the whole report is.
            <div className={cn(SECTION_RULE, "space-y-3")} onClick={openDetailFrom('reko')}>
              {operation.rekoSummary.hasDangers && operation.rekoSummary.dangerTypes.length > 0 && (
                <div className="flex items-start gap-1.5">
                  {/* Chips, so the same offset the resource rows use (mt-1), and
                      the same 3.5 glyph — it used to be a smaller icon sitting
                      above its badges. */}
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                  <div className="flex flex-wrap gap-1">
                    {operation.rekoSummary.dangerTypes.map((danger, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs px-1.5 py-0.5">
                        {danger}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                {operation.rekoSummary.personnelCount && (
                  <span className="mr-3">{t('card.persCount', { count: operation.rekoSummary.personnelCount })}</span>
                )}
                {operation.rekoSummary.estimatedDuration && (
                  <span>{operation.rekoSummary.estimatedDuration}h</span>
                )}
              </div>
            </div>
          )}
        </div>
          </Card>
          {closestEdge === 'bottom' && <DropIndicator edge="bottom" gap="4px" />}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-52 max-h-[var(--radix-context-menu-content-available-height)] overflow-y-auto"
        collisionPadding={{ top: 8, bottom: 80, left: 8, right: 8 }}
      >
        {/* Bearbeiten */}
        <ContextMenuItem onClick={() => openDetail()}>
          <PenLine className="mr-2 h-4 w-4" />
          {t('common.edit')}
        </ContextMenuItem>

        {/* Zuweisen — reko, crew, vehicle, material, and resource transfer */}
        {(onAssignReko || onAssignResource || onTransfer || onDistributeToAuftrag) && (
          <>
            <ContextMenuSeparator />
            {onAssignReko && (
              <ContextMenuItem onClick={() => onAssignReko()}>
                <Binoculars className="mr-2 h-4 w-4" />
                {operation.assignedReko ? t('card.changeReko') : t('card.assignReko')}
              </ContextMenuItem>
            )}
            {onAssignResource && (
              <>
                <ContextMenuItem onClick={() => onAssignResource('crew', operation.id)}>
                  <Users className="mr-2 h-4 w-4" />
                  {t('common.assignCrew')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onAssignResource('vehicles', operation.id)}>
                  <Truck className="mr-2 h-4 w-4" />
                  {t('common.assignVehicle')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onAssignResource('materials', operation.id)}>
                  <Package className="mr-2 h-4 w-4" />
                  {t('common.assignMaterial')}
                </ContextMenuItem>
              </>
            )}
            {onTransfer && (
              <ContextMenuItem onClick={() => onTransfer()}>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                {t('common.transferResources')}
              </ContextMenuItem>
            )}
            {onDistributeToAuftrag && (
              <ContextMenuItem onClick={() => onDistributeToAuftrag()}>
                <Waypoints className="mr-2 h-4 w-4" />
                {t('common.distributeToAuftrag')}
              </ContextMenuItem>
            )}
          </>
        )}

        {/* Markieren — quick status flags. «Zu Fuss» is deliberately NOT here
            any more: it lives in the vehicle assignment dialog (where the
            not-a-vehicle choice belongs) and on the card's own zu-Fuss chip. */}
        {(onToggleNachbarhilfe || onToggleAmWarten) && (
          <>
            <ContextMenuSeparator />
            {onToggleNachbarhilfe && (
              <ContextMenuItem onClick={() => onToggleNachbarhilfe()}>
                <Building2 className="mr-2 h-4 w-4" />
                {operation.nachbarhilfe ? t('card.removeNachbarhilfe') : t('card.markNachbarhilfe')}
              </ContextMenuItem>
            )}
            {onToggleAmWarten && (
              <ContextMenuItem onClick={() => onToggleAmWarten()}>
                <Timer className="mr-2 h-4 w-4" />
                {operation.amWarten ? t('card.removeAmWarten') : t('card.markAmWarten')}
              </ContextMenuItem>
            )}
          </>
        )}

        {/* Status — lifecycle. Editor-only: archive an incident that turned out
            not to be relevant (same completion path as dragging to ABGESCHLOSSEN). */}
        {onRequestComplete && operation.status !== "complete" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onRequestComplete()}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {t('card.completeIncident')}
            </ContextMenuItem>
          </>
        )}

        {/* Ansicht & Druck */}
        <ContextMenuSeparator />
        <ContextMenuItem asChild>
          <Link href={`/map?highlight=${operation.id}`}>
            <Map className="mr-2 h-4 w-4" />
            {t('card.showOnMapMenu')}
          </Link>
        </ContextMenuItem>
        {printerEnabled && (
          <ContextMenuItem onClick={handlePrint} disabled={isPrinting}>
            <Printer className="mr-2 h-4 w-4" />
            {isPrinting ? t('card.printing') : t('common.printSlip')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Same strings, same order — the card draws lists of text, so a comparator that
 * only counted them would hold a stale label whenever one value is swapped for
 * another (Einsturz → Brandgefahr: still one chip, still the old word).
 */
export function sameStrings(prev: readonly string[], next: readonly string[]): boolean {
  return prev.length === next.length && prev.every((value, i) => value === next[i])
}

// Memoize the component to prevent unnecessary re-renders
// Only re-render if props actually change (deep comparison)
export const DraggableOperation = memo(DraggableOperationBase, (prevProps, nextProps) => {
  // Check if REKO summary has changed. Only what the card draws: the chips,
  // the head count and the duration — not `summaryText` or `photos`, which
  // live in the detail view.
  const rekoSummaryChanged =
    prevProps.operation.hasCompletedReko !== nextProps.operation.hasCompletedReko ||
    prevProps.operation.rekoArrivedAt?.getTime() !== nextProps.operation.rekoArrivedAt?.getTime() ||
    (prevProps.operation.rekoSummary?.hasDangers !== nextProps.operation.rekoSummary?.hasDangers) ||
    !sameStrings(
      prevProps.operation.rekoSummary?.dangerTypes ?? [],
      nextProps.operation.rekoSummary?.dangerTypes ?? []
    ) ||
    (prevProps.operation.rekoSummary?.personnelCount !== nextProps.operation.rekoSummary?.personnelCount) ||
    (prevProps.operation.rekoSummary?.estimatedDuration !== nextProps.operation.rekoSummary?.estimatedDuration)

  // Check if assigned reko has changed. The card draws the name, so a person
  // renamed under the same id has to get through here too.
  const assignedRekoChanged =
    prevProps.operation.assignedReko?.id !== nextProps.operation.assignedReko?.id ||
    prevProps.operation.assignedReko?.name !== nextProps.operation.assignedReko?.name

  return (
    prevProps.operation.id === nextProps.operation.id &&
    prevProps.operation.status === nextProps.operation.status &&
    prevProps.operation.priority === nextProps.operation.priority &&
    prevProps.operation.location === nextProps.operation.location &&
    // The heading IS `locationDisplay` whenever the server has one, so a
    // re-geocoded address that only changes the server label has to get through
    // here — otherwise the card keeps the old street until something unrelated
    // repaints it.
    prevProps.operation.locationDisplay === nextProps.operation.locationDisplay &&
    prevProps.operation.notes === nextProps.operation.notes &&
    // The Melder block reads both — without them a corrected callback number
    // would sit stale on the card until something else forced a repaint.
    prevProps.operation.contact === nextProps.operation.contact &&
    prevProps.operation.contactPhone === nextProps.operation.contactPhone &&
    prevProps.operation.incidentType === nextProps.operation.incidentType &&
    prevProps.operation.nachbarhilfe === nextProps.operation.nachbarhilfe &&
    // The note IS the chip's label when there is one — the flag alone would
    // leave a corrected «Nachbarhilfe Therwil» reading as the old town.
    prevProps.operation.nachbarhilfeNote === nextProps.operation.nachbarhilfeNote &&
    prevProps.operation.amWarten === nextProps.operation.amWarten &&
    prevProps.operation.zuFuss === nextProps.operation.zuFuss &&
    prevProps.operation.source === nextProps.operation.source &&
    // The field reports drive two card badges; without them here a card that
    // just got "Abholung nötig" over the WebSocket would not repaint.
    prevProps.operation.pickupNeeded === nextProps.operation.pickupNeeded &&
    prevProps.operation.pickupNote === nextProps.operation.pickupNote &&
    prevProps.operation.pickupRequestedAt?.getTime() === nextProps.operation.pickupRequestedAt?.getTime() &&
    prevProps.operation.fieldCompleteReportedAt?.getTime() ===
      nextProps.operation.fieldCompleteReportedAt?.getTime() &&
    // Both field reports drive the nudge row, so an arrival that lands over the
    // WebSocket has to get through this comparator too.
    prevProps.operation.fieldArrivedAt?.getTime() ===
      nextProps.operation.fieldArrivedAt?.getTime() &&
    prevProps.operation.hasSchadenplatzRapport === nextProps.operation.hasSchadenplatzRapport &&
    // "Kein Rapport" is only shown on a Schadenplatz somebody was actually sent
    // to, so the answer to that has to reach the card as well.
    prevProps.operation.hasSchadenplatzRapportDraft === nextProps.operation.hasSchadenplatzRapportDraft &&
    prevProps.operation.hasBeenDispatched === nextProps.operation.hasBeenDispatched &&
    prevProps.operation.groupId === nextProps.operation.groupId &&
    prevProps.operation.groupPosition === nextProps.operation.groupPosition &&
    prevProps.operation.leaderName === nextProps.operation.leaderName &&
    sameStrings(prevProps.operation.crew, nextProps.operation.crew) &&
    sameStrings(prevProps.operation.materials, nextProps.operation.materials) &&
    sameStrings(prevProps.operation.vehicles, nextProps.operation.vehicles) &&
    prevProps.operation.vehicles.every((v) => prevProps.operation.vehicleDriverStay?.get(v) === nextProps.operation.vehicleDriverStay?.get(v)) &&
    // Drawn next to the vehicle name, and edited in the fleet settings without
    // the incident itself changing at all.
    prevProps.operation.vehicles.every((v) => prevProps.operation.vehicleCallsigns?.get(v) === nextProps.operation.vehicleCallsigns?.get(v)) &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isKeyboardFocused === nextProps.isKeyboardFocused &&
    prevProps.index === nextProps.index &&
    // Every view switch, field by field. `cardViewEquals` iterates
    // CARD_VIEW_KEYS and CardViewSettings is derived from that same list, so a
    // flag added later cannot exist without landing in this comparison — the one
    // failure mode of a hand-written comparator (a switch that flips but never
    // repaints) is closed by the type, not by remembering.
    cardViewEquals(prevProps.cardView ?? DEFAULT_CARD_VIEW, nextProps.cardView ?? DEFAULT_CARD_VIEW) &&
    !rekoSummaryChanged &&
    !assignedRekoChanged &&
    // Conflict set: identity check is enough — page.tsx memoizes the Set
    // via useMemo, so a new reference means the underlying value changed.
    prevProps.doubleBookedCrewNames === nextProps.doubleBookedCrewNames
  )
})

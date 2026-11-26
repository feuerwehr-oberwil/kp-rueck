"use client"

import { useState, useEffect, useCallback, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { type Operation, type Material, type OperationStatus } from "@/lib/contexts/operations-context"
import { useOperations } from "@/lib/contexts/operations-context"
import {
  OPERATION_DETAIL_TABS,
  readRememberedTab,
  rememberDetailTab,
  useOperationDetailShortcutTabs,
  useOperationDetailTabArrows,
  type OperationDetailSection,
  type OperationDetailTab,
} from "@/lib/hooks/use-operation-detail-shortcuts"
import { useIncidentTimeline } from "@/lib/hooks/use-incident-timeline"
import { useGroups } from "@/lib/contexts/groups-context"
import { useReleaseUndo } from '@/lib/hooks/use-release-undo'
import { getIncidentRefParts, getIncidentTypeLabel } from "@/lib/incident-types"
import { useVehicleDriverState } from "@/lib/hooks/use-vehicle-drivers"
import { useVehicleShortcuts } from "@/lib/contexts/operations/use-vehicle-shortcuts"
import { useRekoLinkActions } from "@/lib/hooks/use-reko-link-actions"
import { ScrollEndFade } from "@/components/ui/scroll-end-fade"
import { cn } from "@/lib/utils"
import { useEvent } from "@/lib/contexts/event-context"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"
import { IncidentTimeline } from "@/components/kanban/incident-timeline"
import { IncidentParticipants } from "@/components/kanban/incident-participants"
import { FieldStatusNudge } from "@/components/kanban/field-status-nudge"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { TransferRekoDialog } from "@/components/kanban/transfer-reko-dialog"
import { usePersonnel } from "@/lib/contexts/personnel-context"
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { PhotoViewerProvider } from '@/components/photos/photo-viewer'
import { rekoPhotoUrl } from '@/lib/reko-photos'
import { takesAssignments } from '@/lib/assignable'
import { isResourceDrag, type BoardDropTarget } from '@/lib/board-drag'
import { detailTabLayout } from "@/components/kanban/operation-detail-tab-layout"
import { OperationDetailHeader } from "@/components/kanban/operation-detail-header"
import { OverviewFields, useOverviewFieldSaves } from "@/components/kanban/operation-detail-overview-fields"
import { OverviewForces } from "@/components/kanban/operation-detail-overview-forces"
import { OwnResourceSections } from "@/components/kanban/operation-detail-own-resources"
import { RekoTab } from "@/components/kanban/operation-detail-reko-tab"
import { RapportTab } from "@/components/kanban/operation-detail-rapport-tab"
import { OperationDetailActionBar } from "@/components/kanban/operation-detail-action-bar"

export interface OperationDetailContentProps {
  operation: Operation
  layout: 'modal' | 'panel'
  /** Rendered at the right end of the title row. The side panel puts its
   *  mode switch and its close button there rather than on a bar of its own. */
  headerActions?: ReactNode
  active?: boolean
  /** "Open on THIS tab" — a notification click, or a click on one block of a
   *  kanban card, which is the operator pointing at one specific thing
   *  (§18.27). It beats the remembered tab for that one opening and is
   *  deliberately NOT written back to the memory: reopening the card by hand
   *  later still returns to whatever tab they were working in.
   *
   *  Carries a `nonce` because the panel does not remount when the same
   *  incident is opened again — clicking the same notification twice has to
   *  bring the tab forward both times.
   *
   *  `section` narrows it one step further, to a block inside the tab. */
  openOnTab?: { tab: OperationDetailTab; nonce: number; section?: OperationDetailSection }
  canEdit?: boolean
  onUpdate: (updates: Partial<Operation>) => void
  onDelete?: (operationId: string) => void
  materials: Material[]
  /** Accepted for caller compatibility but no longer read: assigning a vehicle
   *  goes through the full assignment dialog (`onAssignResource('vehicles')`),
   *  not an inline picker. */
  onAssignVehicle?: (vehicleId: string, vehicleName: string, operationId: string) => void
  onRemoveVehicle?: (operationId: string, vehicleId: string) => void
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string, search?: string) => void
  onRemoveCrew?: (operationId: string, personnelId: string) => void
  onRemoveMaterial?: (operationId: string, materialId: string) => void
  diveraEnabled?: boolean
  onSendDivera?: (operation: Operation) => void
  /** Editor-only: archive the incident (status → complete) via the shared
      completion + material-decision flow. Surfaced in the Reko-Meldung card. */
  onRequestComplete?: (operationId: string) => void
  /** Opens the Auftrag picker to distribute this incident into a route. */
  onDistributeToAuftrag?: (operationId: string) => void
  /** Opens «Ressourcen übertragen» for this incident (the page's dialog layer
   *  owns the dialog – see incident-dialogs.tsx). */
  onTransferResources?: (operationId: string) => void
  onChangeStatus?: (operationId: string, targetStatus: OperationStatus) => void
}

export function OperationDetailContent({
  operation,
  layout,
  headerActions,
  active = true,
  openOnTab,
  canEdit = true,
  onUpdate,
  onDelete,
  materials,
  onRemoveVehicle,
  onAssignResource,
  onRemoveCrew,
  onRemoveMaterial,
  diveraEnabled,
  onSendDivera,
  onRequestComplete,
  onDistributeToAuftrag,
  onTransferResources,
  onChangeStatus,
}: OperationDetailContentProps) {
  const { formatLocation, refreshOperations, undoMerge } = useOperations()
  const { selectedEvent } = useEvent()
  const { personnel } = usePersonnel()
  const { groups, getGroupResources } = useGroups()
  // Releasing a route resource here offers «Rückgängig» (lib/release-undo.ts).
  const release = useReleaseUndo()

  // The Auftrag (route) a grouped incident hangs in, and the resources it owns —
  // shared by every stop and riding on to the next one. Add/remove inside the
  // route's block targets the Auftrag, so the modal edits the same thing the
  // Aufträge sheet does.
  //
  // Not "the incident then carries none of its own": attaching a stop to a route
  // leaves whatever was assigned to it beforehand exactly where it is (backend
  // `crud/incidents.update_incident`). Those are shown too — see
  // `OwnResourceSections`.
  const auftrag = operation?.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  const auftragResources = auftrag ? getGroupResources(auftrag.id) : null
  // A closed Einsatz takes nothing new (lib/assignable.ts): no «Zuweisen», no Reko, no drop target.
  const acceptsAssignments = takesAssignments(operation)
  const canAssignReko = canEdit && acceptsAssignments

  // The Übersicht fields' save state – kept here, not in `OverviewFields`: see
  // `useOverviewFieldSaves`.
  const fieldSaves = useOverviewFieldSaves(operation)
  // Reopening a Schadenplatz lands on the tab it was left on. An operator
  // working through the rapports of a storm night reopens the same card again
  // and again; sending them back to Übersicht every time is a click per visit.
  /** The requested tab, but only if this detail actually has it. A tab that is
   *  not on screen for this incident would be an empty shell, and Übersicht is
   *  always there — the honest fallback for a pointer that misses. */
  const requestedTab =
    openOnTab && OPERATION_DETAIL_TABS.includes(openOnTab.tab) ? openOnTab.tab : undefined
  const [tab, setTab] = useState<OperationDetailTab>(
    () => requestedTab ?? readRememberedTab(operation.id) ?? 'overview',
  )
  const rootRef = useRef<HTMLDivElement>(null)
  /** Übersicht's Ressourcen block — the landing point for `openOnTab.section`. */
  const resourcesRef = useRef<HTMLDivElement>(null)

  /** The one way the tab changes — so nothing can move it without recording it. */
  const selectTab = useCallback(
    (next: OperationDetailTab) => {
      setTab(next)
      rememberDetailTab(operation.id, next)
    },
    [operation.id],
  )
  // The quick-assign fleet behind `1`..`5` – editors only; off the board sync.
  const fleet = useVehicleShortcuts()
  const availableVehicleCount = canEdit ? fleet.length : 0
  const { drivers: vehicleDrivers, loaded: vehicleDriversLoaded } = useVehicleDriverState()
  const [rekoDialogOpen, setRekoDialogOpen] = useState(false)
  const [rekoTransferDialogOpen, setRekoTransferDialogOpen] = useState(false)

  // Here rather than on the Reko tab, so a «copied» tick survives a tab switch.
  const rekoLinks = useRekoLinkActions({
    incidentId: operation?.id ?? null,
    assignedReko: operation?.assignedReko ?? null,
    eventId: selectedEvent?.id ?? null,
  })

  // Use assignedReko directly from the operation (kept in sync by operations context)
  const assignedRekoPersonnel = operation?.assignedReko ?? null
  const assignedRekoPerson = assignedRekoPersonnel
    ? personnel.find((person) => person.id === assignedRekoPersonnel.id)
      ?? {
        id: assignedRekoPersonnel.id,
        name: assignedRekoPersonnel.name,
        role: '',
        status: 'assigned' as const,
        roleSortOrder: 0,
        isReko: true,
      }
    : null

  // The three effects below are triggered by the incident or by `openOnTab` (whose nonce makes
  // a repeat click a new event) and READ the tab it asks for – never depend on it.
  const currentRequestedTab = useEffectEvent(() => requestedTab)

  useEffect(() => {
    setRekoDialogOpen(false)
    setRekoTransferDialogOpen(false)
    // A different incident brings its own remembered tab, Übersicht if it has
    // none. The modal remounts by key, but the side panel keeps this component
    // alive across selections — read it here rather than trusting the mount.
    // A notification's tab outranks the memory: the operator clicked one
    // specific thing. `setTab`, never `selectTab` — this must not be written
    // back, or one bell click would repoint the card for good.
    // openOnTab is read, not depended on: it must not re-run this reset on its
    // own — the effect below owns that, and doing it here as well would fight
    // an operator who switched tabs after arriving.
    setTab(currentRequestedTab() ?? readRememberedTab(operation.id) ?? 'overview')
  }, [selectedEvent?.id, operation.id])

  // A second (or third) click on the same notification. The panel keeps this
  // component alive for the incident already on screen, so nothing above fires
  // — and "take me to the thing you just told me about" has to work every time,
  // not only the first. The nonce is what makes a repeat click a new event.
  useEffect(() => {
    const tab = currentRequestedTab()
    if (tab) setTab(tab)
  }, [openOnTab])

  /**
   * …and, for a caller that pointed at a block rather than at a tab, put that
   * block on screen. The 420px panel is the reason this exists: its Übersicht
   * is one column, so the Ressourcen sit a full screen below the address, and a
   * click on the card's Mannschaft row would otherwise land on the Einsatzort
   * field. In the modal the block already opens the right-hand column, so the
   * scroll is a no-op there rather than a special case.
   *
   * One frame late, so the tab set above has been rendered before we measure.
   */
  useEffect(() => {
    if (openOnTab?.section !== 'resources' || currentRequestedTab() !== 'overview') return
    const frame = window.requestAnimationFrame(() => {
      resourcesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [openOnTab])

  /**
   * The open side panel takes drops, so a person or a Gerät can go straight
   * onto the incident already on screen instead of being carried back to its
   * card. Panel only: the modal covers the very sidebars the resources are
   * dragged out of, so there is nothing to drop there.
   *
   * **The whole panel, not just the Ressourcen block.** That block was the only
   * target, which made the feature conditional on being on the Übersicht tab
   * *and* on having scrolled the block into view — from the Reko or Rapport tab
   * the panel silently refused every drop, and a refused drop looks exactly
   * like a broken one. So the panel root is a target too. It is registered
   * second and sits further out, and the monitor takes
   * `dropTargets[0]` — the innermost — so the block still wins whenever the
   * pointer is actually over it, and only its ring lights up.
   *
   * The payload is the card's own `operation-drop`, which is what buys the
   * behaviour that matters for free — Doppelbelegung prompt, Reko slot, and a
   * grouped incident routing the assignment to its Auftrag (see
   * `applyResourceDrop`). Cards are refused: neither target has an `index`, so
   * the reorder maths in `applyOperationDrop` has nothing to work with.
   */
  const [isResourceDropOver, setIsResourceDropOver] = useState(false)
  const [isPanelDropOver, setIsPanelDropOver] = useState(false)
  useEffect(() => {
    const root = rootRef.current
    // A closed Einsatz takes no new assignment (lib/assignable.ts): no target, no ring.
    if (!root || layout !== 'panel' || !canEdit || !acceptsAssignments) return

    const dropData = () => ({ type: 'operation-drop', operationId: operation.id }) satisfies BoardDropTarget

    const block = resourcesRef.current
    return combine(
      dropTargetForElements({
        element: root,
        canDrop: ({ source }) => isResourceDrag(source.data),
        getData: dropData,
        onDragEnter: () => setIsPanelDropOver(true),
        onDragLeave: () => setIsPanelDropOver(false),
        onDrop: () => setIsPanelDropOver(false),
      }),
      ...(block
        ? [
            dropTargetForElements({
              element: block,
              canDrop: ({ source }) => isResourceDrag(source.data),
              getData: dropData,
              onDragEnter: () => setIsResourceDropOver(true),
              onDragLeave: () => setIsResourceDropOver(false),
              onDrop: () => setIsResourceDropOver(false),
            }),
          ]
        : []),
    )
  }, [layout, canEdit, acceptsAssignments, operation.id, tab])

  // Shortcut targets that are not on screen: Shift+1/2/3 sets the priority,
  // `0` and `1`..`5` touch "zu Fuss" / the quick-assign fleet — all on
  // Übersicht. Bring that tab forward so the operator sees the change they just
  // made. Editors only — a viewer's keypress changes nothing, so it must not
  // move the view either.
  useOperationDetailShortcutTabs({
    enabled: active && canEdit,
    availableVehicleCount,
    onFocusTab: selectTab,
  })

  // ← / → walk the tabs from anywhere inside the detail. Viewers included: this
  // is navigation, not a mutation, and reading is most of what a viewer does.
  useOperationDetailTabArrows({
    enabled: active,
    tab,
    containerRef: rootRef,
    focusTrapped: layout === 'modal',
    onFocusTab: selectTab,
  })

  /**
   * Put the keyboard inside the panel — the half of the arrow-key story a modal
   * gets for free.
   *
   * The modal traps focus, so every keystroke while it is open is a keystroke
   * in the modal. The panel traps nothing: the board behind it is live, the
   * kanban card that opened it is not a focusable element, and most of the
   * panel's own surface is inert text. So a click on a card — or on the panel's
   * own heading — leaves `document.activeElement` on `<body>`, the arrow keys
   * belong to nobody, and Chrome spends them scrolling `#kanban-main`
   * horizontally. That is what "the arrows do not work in the panel" was.
   *
   * The boundary drawn here is *the surface you last touched owns the arrows*:
   * touch the panel and it takes them, touch the board — anywhere, including
   * empty background — and the browser has them back for scrolling. Nothing is
   * claimed globally, and no keystroke is stolen from a control that wants it.
   */
  const focusPanelRoot = useCallback(() => {
    if (layout !== 'panel') return
    // `preventScroll`: the panel is already on screen, and scrolling its
    // content to the top under the operator would be a worse bug than the one
    // this fixes.
    rootRef.current?.focus({ preventScroll: true })
  }, [layout])

  // Selecting a card IS the act of pointing at the panel — the click has no
  // other effect. Mount-only: the panel remounts per incident (it is keyed on
  // event + incident), and the board opens with nothing selected, so this can
  // never fire without an operator having asked for this incident.
  useEffect(() => {
    focusPanelRoot()
  }, [focusPanelRoot])

  /** A click on inert panel content — a heading, a label, whitespace — would
   *  otherwise blur to `<body>` and hand the arrows back to the board while the
   *  operator is looking straight at the panel. Controls keep their own click:
   *  a button, an input or anything else focusable focuses itself, and the
   *  arrows then follow the caret rules in `resolveArrowTabStep`. */
  const handlePanelPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (layout !== 'panel') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest(
          'a[href], button, input, textarea, select, [role="combobox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        )
      ) {
        return
      }
      focusPanelRoot()
    },
    [layout, focusPanelRoot],
  )

  // Status changes, assignments and the crew's Freitext-Meldungen, fetched once
  // for the two tabs that show them: Verlauf renders all of it, Rapport renders
  // the messages as a thread. Not fetched at all while Übersicht is in front,
  // which is where a board click lands.
  const timeline = useIncidentTimeline(operation.id, active && (tab === 'history' || tab === 'rapport'))

  const { dense, sectionStep, tabGridClass } = detailTabLayout(layout)
  // The one scrolling region: the dialog itself is a fixed 85vh, so switching
  // tabs must never resize it or scroll the header away.
  // `scroll`, not `auto`: every one of these panels grows the moment a folded
  // block is opened, and a scrollbar that appears at that moment narrows the
  // column under the pointer — the row you were about to click moves.
  // `overflow-x-hidden`: a long unbroken value (URL in the Meldung, a wide
  // chip row) must wrap or clip — the panel itself never scrolls sideways.
  const tabPanelClass = "min-h-0 flex-1 overflow-y-scroll overflow-x-hidden"
  /**
   * The last child of every scrolling tab: the shared `ScrollEndFade` (r18). The
   * `-mt-3` lays half of it over the grid's 12px bottom padding, so the tab gains
   * 12px of end room and the last row scrolls fully clear of the footer rule
   * instead of being cut through its glyphs. It ends in the surface the tab sits
   * on: the dialog's in the modal, the panel's in the side panel.
   */
  const scrollEndFade = <ScrollEndFade surface={layout === 'modal' ? 'dialog' : 'panel'} className="-mt-3" />
  /**
   * The banners: what came in from the field and is still waiting for the KP to
   * do something about it — «Feld meldet beendet / angekommen» and «Abholung».
   * One group, two homes, because the two mounts have different room for it:
   *
   *  * modal — first thing in the Übersicht RIGHT column, above «Kräfte»,
   *    beside the fields that end in the «Status» row those questions are about.
   *  * panel — a full-width strip directly under the tab bar. 420px has no
   *    second column to put them in, and burying them inside Übersicht would
   *    hide them whenever the operator is on Rapport or Verlauf.
   *
   * `empty:hidden` is what keeps the group honest: FieldStatusNudge renders
   * nothing once its question has been answered, and a dismissed nudge with no
   * pickup must not leave a padded gap under the tabs. A `display:none` box
   * carries no margin either, so the spacing below can stay on this element.
   */
  const banners = (
    <div className={cn("space-y-2 empty:hidden", dense ? "flex-shrink-0 pt-3" : "mb-4")}>
      {(operation.fieldCompleteReportedAt || operation.fieldArrivedAt) && (
        <FieldStatusNudge operation={operation} canEdit={canEdit} variant="detail" />
      )}
      {/* Stays visible on a completed incident on purpose, and is the KP's
          «Abholung disponiert» control here as everywhere else — passing
          `incidentId` is what turns it into that button. */}
      {operation.pickupNeeded && (
        <PickupBadge
          requestedAt={operation.pickupRequestedAt}
          note={operation.pickupNote}
          incidentId={operation.id}
          canEdit={canEdit}
          variant="banner"
        />
      )}
    </div>
  )

  // The incident's photo viewer (#5): its head names the Einsatz; the board's Reko summary
  // stands in for the Reko photos while the Reko tab (which registers the live ones) is closed.
  const photoLabel = getIncidentRefParts(operation).head
  const photoFallback = useMemo(
    () => ({
      reko: (operation.rekoSummary?.photos ?? []).map(filename => ({
        group: 'reko' as const,
        filename,
        src: rekoPhotoUrl(operation.id, filename),
        by: null,
        at: null,
      })),
    }),
    [operation.id, operation.rekoSummary?.photos],
  )

  return (
    <PhotoViewerProvider incidentLabel={photoLabel} fallback={photoFallback}>
    <div
      ref={rootRef}
      // A focus sink, and only in the panel: the modal traps focus, so "inside
      // the modal" is already everywhere. See `focusPanelRoot` above for why
      // the panel needs one. `outline-none` because this is not a control —
      // it holds the keyboard, it does not invite a click.
      tabIndex={layout === 'panel' ? -1 : undefined}
      onPointerDown={handlePanelPointerDown}
      className={cn(
        "flex h-full min-h-0 flex-col",
        layout === 'panel' && "outline-none",
        // The panel's own density (hill climb r22): every dense control 28px instead of the
        // token's 32 and 6px between two rows instead of 8 – still ONE height for the whole
        // form, restated here rather than in the token, because the modal has the room the
        // 420px panel lacks. It buys the laptop the «Kräfte» rows above the footer. From `md`
        // only: below it the token is the 44px touch floor, and that one stays.
        layout === 'panel' && "[--detail-row-py:3px] md:[--field-h-dense:1.75rem]",
        // Only when the Ressourcen block itself is NOT the target: a nested
        // drop target leaves its parent "entered" too, and two rings around one
        // drop is a question about which of them takes it.
        isPanelDropOver && !isResourceDropOver &&
          "rounded-lg ring-2 ring-sel-line ring-offset-2 ring-offset-background",
      )}
      data-testid="operation-detail-content"
      data-layout={layout}
    >
        {/* Radix Tabs: the trigger list is one tab stop with arrow-key roving
            focus between the three triggers, the panel is the next. Nothing here
            overrides tabIndex, so that stays intact. The root wraps the header
            too, because the tab bar lives IN the header row — the modal is
            already taller than a 1280x800 laptop likes, and a tab bar on a line
            of its own was a whole row spent on nothing but the empty space to
            the right of the address. */}
        <Tabs
          value={tab}
          onValueChange={(value) => selectTab(value as OperationDetailTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
        {/* One centre line for the whole row, and — in the modal — a reserved
            strip on the right for the dialog's close X. The X is a window
            control and owns the true corner (`absolute top-4 right-4`, which
            reaches 24px into the content box); the tabs are content and must
            not be pushed under it. */}
        <OperationDetailHeader operation={operation} layout={layout} tab={tab} headerActions={headerActions} />

          {/* The panel's home for the banners: under the tabs, above whichever
              tab is in front — see `banners` above. */}
          {dense && banners}

          {/* ------------------------------------------------------ Übersicht */}
          <TabsContent value="overview" className={tabPanelClass}>
          <div className={tabGridClass}>
          {/* Left Column — the fields, as rows in both mounts, gathered under
              the small grey group headings. No hairlines between rows any more:
              whitespace separates, the headings group. */}
          {/* `fields` + the rows' own padding = the section step (6 + 3 + 3 = 12px in the
              panel, 8 + 4 + 4 = 16px in the modal). */}
          <OverviewFields
            operation={operation}
            layout={layout}
            canEdit={canEdit}
            saves={fieldSaves}
            onUpdate={onUpdate}
            onChangeStatus={onChangeStatus}
          />

          {/* Right column — who is on it. Ressourcen used to be a tab of its
              own; an operator asking "what is this and who is there" was made
              to click twice for one question, and the modal is wide enough to
              answer it in one look. */}
          <OverviewForces
            operation={operation}
            layout={layout}
            canEdit={canEdit}
            auftrag={auftrag}
            auftragResources={auftragResources}
            acceptsAssignments={acceptsAssignments}
            canAssignReko={canAssignReko}
            assignedRekoPersonnel={assignedRekoPersonnel}
            banners={banners}
            ownResources={
              <OwnResourceSections
                operation={operation}
                auftrag={auftrag}
                canEdit={canEdit}
                acceptsAssignments={acceptsAssignments}
                materials={materials}
                vehicleDrivers={vehicleDrivers}
                onUpdate={onUpdate}
                onAssignResource={onAssignResource}
                onRemoveCrew={onRemoveCrew}
                onRemoveVehicle={onRemoveVehicle}
                onRemoveMaterial={onRemoveMaterial}
              />
            }
            resourcesRef={resourcesRef}
            isResourceDropOver={isResourceDropOver}
            vehicleDrivers={vehicleDrivers}
            vehicleDriversLoaded={vehicleDriversLoaded}
            release={release}
            selectTab={selectTab}
            openRekoDialog={() => setRekoDialogOpen(true)}
            onAssignResource={onAssignResource}
          />
          </div>
            {scrollEndFade}
          </TabsContent>

          {/* ----------------------------------------------------------- Reko */}
          {/* What somebody went to LOOK at, before the work — written once,
              amended over the radio, and read while deciding what to send. That
              is a different moment from everything below, which is why it is no
              longer stacked on top of it. */}
          <TabsContent value="reko" className={tabPanelClass}>
            {/* Two columns, the same grid as Übersicht: what came IN from the
                field on the LEFT, what the KP sets or administers on the RIGHT.
                Feld reads the same way, so the two field tabs are siblings.
                They were briefly one stacked column — which put an unassigned
                Reko, its Funkmeldung and «noch kein Bericht» in a single narrow
                run and read as a form with nothing in it. */}
            <RekoTab
              operation={operation}
              layout={layout}
              canEdit={canEdit}
              canAssignReko={canAssignReko}
              assignedRekoPersonnel={assignedRekoPersonnel}
              rekoLinks={rekoLinks}
              openRekoDialog={() => setRekoDialogOpen(true)}
              openRekoTransferDialog={() => setRekoTransferDialogOpen(true)}
              onRequestComplete={onRequestComplete}
            />
            {scrollEndFade}
          </TabsContent>

          {/* ------------------------------------------- Feld & Rapport */}
          {/* `forceMount` on this one panel only: it is the sole tab holding an
              editing surface with its own state (the rapport form's autosave
              and the material return list). Unmounting it on every tab switch
              would refetch and re-restore the local draft mid-entry. The others
              are read-and-act surfaces where a remount costs nothing.
              `hidden` is set explicitly because Radix leaves visibility to the
              caller once forceMount is on. */}
          <TabsContent
            value="rapport"
            forceMount
            hidden={tab !== 'rapport'}
            className={tabPanelClass}
          >
          {/* Two columns, the same grid as Reko and Übersicht: what came IN
              from the field on the left — Abholung, Anforderungen, the crew's
              messages — and the rapport on the right, whose Material block is
              the tab's one place for material (pick 1A, 24.11.2026). */}
          <RapportTab
            operation={operation}
            layout={layout}
            canEdit={canEdit}
            acceptsAssignments={acceptsAssignments}
            timeline={timeline}
            autoFocusKurzbericht={openOnTab?.tab === 'rapport' && openOnTab.section === 'kurzbericht'}
            onAssignResource={onAssignResource}
          />
            {scrollEndFade}
          </TabsContent>

          {/* -------------------------------------------------------- Verlauf */}
          <TabsContent value="history" className={tabPanelClass}>
          {/* Everything, expanded, no toggles. The Verlauf tab IS the "show me
              the history" click; a collapsed panel inside it was a second one.
              Two lists, newest-first: what happened (status changes,
              assignments and the crew's messages interleaved), and who was
              here — the same three resource kinds as Übersicht but including
              everything already released. Single column on purpose. */}
          <div className={cn(sectionStep.stack, sectionStep.pad)}>
            <IncidentTimeline
              events={timeline.events}
              isLoading={timeline.isLoading}
              failed={timeline.failed}
              onRetry={timeline.reload}
              onUnmerge={
                canEdit
                  ? async (mergedId) => {
                      if (await undoMerge(mergedId)) timeline.reload()
                    }
                  : undefined
              }
            />
            <IncidentParticipants incidentId={operation.id} />
          </div>
            {scrollEndFade}
          </TabsContent>
        </Tabs>

        {/* Actions - Fixed Footer */}
        <OperationDetailActionBar
          operation={operation}
          layout={layout}
          canEdit={canEdit}
          acceptsAssignments={acceptsAssignments}
          materials={materials}
          vehicleDrivers={vehicleDrivers}
          onDelete={onDelete}
          diveraEnabled={diveraEnabled}
          onSendDivera={onSendDivera}
          onDistributeToAuftrag={onDistributeToAuftrag}
          onTransferResources={onTransferResources}
        />

      {/* Assign Reko Dialog */}
      <AssignRekoDialog
        open={rekoDialogOpen && acceptsAssignments}
        onOpenChange={setRekoDialogOpen}
        incidentId={operation.id}
        incidentTitle={formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)}
        onAssigned={() => {
          // The dialog no longer closes itself on success — see `onAssigned`.
          setRekoDialogOpen(false)
          void refreshOperations()
        }}
      />

      {assignedRekoPerson && (
        <TransferRekoDialog
          open={rekoTransferDialogOpen}
          onOpenChange={setRekoTransferDialogOpen}
          fromPerson={assignedRekoPerson}
          rekoPersonnel={personnel.filter((person) => person.isReko)}
          onTransferred={() => void refreshOperations()}
        />
      )}
    </div>
    </PhotoViewerProvider>
  )
}


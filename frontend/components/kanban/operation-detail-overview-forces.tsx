"use client"

import { type ReactNode, type RefObject } from "react"
import { useTranslations } from "next-intl"
import { Binoculars, ChevronRight, Shield } from 'lucide-react'
import { DetailGroupHeading } from "@/components/kanban/detail-field"
import { PersonName } from "@/components/person-name"
import { RouteResourceSections, ResourceSourceBlock } from "@/components/kanban/route-resource-sections"
import { type Operation, useOperations } from "@/lib/contexts/operations-context"
import { type IncidentGroup, useGroups } from "@/lib/contexts/groups-context"
import { type GroupResources } from "@/lib/types/groups"
import { type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { usePromoteRouteLeader } from "@/lib/hooks/use-promote-to-leader"
import { type useReleaseUndo } from '@/lib/hooks/use-release-undo'
import { type VehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { formatClockTime } from "@/lib/incident-time"
import { cn } from "@/lib/utils"
import { detailTabLayout, type DetailLayout } from "@/components/kanban/operation-detail-tab-layout"

/**
 * Übersicht's right column, «Kräfte»: the modal's banners, then the Reko line
 * and the resources grouped by where they come from — the Auftrag's, and the
 * incident's own (`ownResources`, the `OwnResourceSections` element).
 * Rendered by `OperationDetailContent` as the second column of the Übersicht
 * grid. `resourcesRef` and `isResourceDropOver` belong to the detail's scroll
 * and drop-target effects; `release` is the detail's `useReleaseUndo`, so a
 * release survives a tab switch.
 */
export function OverviewForces({
  operation,
  layout,
  canEdit,
  auftrag,
  auftragResources,
  acceptsAssignments,
  canAssignReko,
  assignedRekoPersonnel,
  banners,
  ownResources,
  resourcesRef,
  isResourceDropOver,
  vehicleDrivers,
  vehicleDriversLoaded,
  release,
  selectTab,
  openRekoDialog,
  onAssignResource,
}: {
  operation: Operation
  layout: DetailLayout
  canEdit: boolean
  auftrag: IncidentGroup | undefined
  auftragResources: GroupResources | null
  acceptsAssignments: boolean
  canAssignReko: boolean
  assignedRekoPersonnel: Operation['assignedReko']
  banners: ReactNode
  ownResources: ReactNode
  resourcesRef: RefObject<HTMLDivElement | null>
  isResourceDropOver: boolean
  vehicleDrivers: VehicleDrivers
  vehicleDriversLoaded: boolean
  release: ReturnType<typeof useReleaseUndo>
  selectTab: (next: OperationDetailTab) => void
  openRekoDialog: () => void
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string, search?: string) => void
}) {
  const t = useTranslations('kanban')
  const { requestVehicleDriver } = useOperations()
  const { setRouteDriverStay } = useGroups()
  const { dense, tabColumnBreakClass } = detailTabLayout(layout)
  /** Same promotion, one level up: the route owns the people, so a grouped
   *  incident's leader is set on the Auftrag. */
  const promoteRouteLeader = usePromoteRouteLeader()

  /** Does this incident hold anything of its own? Decides whether the «Nur
   *  dieser Einsatz» block exists at all — an incident that was grouped before
   *  anybody assigned to it has nothing to show and gets no second head. */
  const hasOwnResources =
    operation.crew.length > 0 || operation.vehicles.length > 0 || operation.materials.length > 0 || operation.zuFuss

  /** The one number the radio asks for: everything on this Schadenplatz,
   *  whichever side of the provenance line it sits on. Borrowed from Variante B
   *  of mockup 08 — it exists nowhere else in the app today. «Zu Fuss» is a way
   *  of getting there, not a resource, so it is not counted.
   *
   *  The Reko IS counted. The heading covers the Reko line as much as the three
   *  rows under it, and an incident with a Reko out and nothing else read
   *  «Kräfte (0)» directly above that person's name — the count called a
   *  firefighter standing on the Schadenplatz nobody. They are not in
   *  `operation.crew`: the Reko assignment is its own field, which is exactly
   *  why the sum missed them. */
  const totalResourceCount =
    (operation.assignedReko ? 1 : 0) +
    operation.crew.length +
    operation.vehicles.length +
    operation.materials.length +
    (auftragResources
      ? auftragResources.personnel.length + auftragResources.vehicles.length + auftragResources.materials.length
      : 0)

  return (
    <div className={tabColumnBreakClass}>
    {/* The modal's home for the banners: the same questions the card
        asks — the field reported «angekommen» / «beendet», and the next
        thing an operator does about it is move the card (the nudge's own
        button, or the «Status» row across the gutter). The nudge's dismissal is shared with the card
        behind the modal (one external store in field-status-nudge.tsx),
        so the X only has to be clicked once. In the panel this same group
        sits under the tab bar instead — see `banners` in `OperationDetailContent`. */}
    {!dense && banners}

    {/* Ressourcen — Reko, Mannschaft, Fahrzeuge, Material. Reached
        directly by a click on the matching block of a kanban card, which
        is what the ref is for (see the scroll effect in `OperationDetailContent`). */}
    <div
      ref={resourcesRef}
      data-detail-section="resources"
      className={cn(
        // The drop ring sits OUTSIDE the block (`ring-offset`) so it reads
        // as "this whole list takes it" rather than as a field focus.
        "rounded-lg transition-colors",
        isResourceDropOver && "ring-2 ring-sel-line ring-offset-4 ring-offset-background bg-sel-wash"
      )}
    >
      {/* «Kräfte» — the third of the mock's group headings: who and what
          is out there. Covers the Reko line and the Ressourcen below;
          it follows the fields directly (status is a field row now). */}
      {/* The count rides on the heading — «Kräfte (7)» is what gets asked
          for over the radio; the standalone «Ressourcen (n)» line it
          replaces said the same thing one heading level lower. */}
      {/* «KRÄFTE · 4»: the caps label takes the count as a fact after a
          middle dot, like the board's column heads – «(4)» in a caps
          line read as a footnote. Its glyph puts the word on the same
          edge as the other group headings (hill climb r18). */}
      <DetailGroupHeading icon={<Shield className="h-3.5 w-3.5 shrink-0" />}>
        {t('detail.groups.kraefte')} · {totalResourceCount}
      </DetailGroupHeading>
      {/* Reko, as ONE line: who is out looking, since when — and a way
          through to the rest. The five controls that used to live here
          (zuweisen/wechseln, the two links, the event-wide transfer) are
          on the Reko tab now: they are used about once per incident, and
          they were taking a quarter of a column that also carries Status
          ändern, Mannschaft, Fahrzeuge and Material. The line stays a
          button rather than becoming plain text, because assigning a Reko
          happens at the busiest moment and must not go into hiding — it
          is one click from here, the same click the card's Reko block
          makes. */}
      <button
        type="button"
        // Unassigned, this line reads «Reko zuweisen» — so it does that,
        // rather than dropping the operator on a tab where they have to
        // find the button again. It still switches tabs first, so the
        // dialog closes onto the Reko block that now owns the
        // assignment and not onto the Übersicht they came from.
        onClick={() => {
          selectTab('reko')
          if (canAssignReko && !assignedRekoPersonnel) openRekoDialog()
        }}
        // The same hover tint and the same rhythm as the empty
        // `ResourceRow`s below it: one target, one highlight.
        className="-mx-1 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-muted/40"
        title={canAssignReko && !assignedRekoPersonnel ? t('card.assignReko') : t('detail.tabs.reko')}
        aria-label={canAssignReko && !assignedRekoPersonnel ? t('card.assignReko') : undefined}
      >
        {/* The SAME gutter as the three `ResourceRow`s below, so the
            four values of the group start on one edge. It used to be an
            icon plus a bold «Reko» sized to the word, which put the name
            70px to the left of every chip under it — the one row of the
            group that did not line up. The binoculars stay, demoted into
            the label: it is the mnemonic, not a second heading level. */}
        {/* With an Auftrag the rows below sit in `ResourceSourceBlock`s, whose bar and
            padding push their values 14px right (border-l-2 + pl-3); the Reko value
            follows, so all four still start on one edge (owner, 26.11.2026: «Kurmann
            Thomas» stood left of the Auftrag's «keine» and «TLF»). Narrowing the
            block's gutter instead wrapped «Mannschaft · 3». */}
        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground", auftrag ? "w-[134px]" : "w-[120px]")}>
          <Binoculars className="h-3.5 w-3.5 shrink-0" />
          {t('common.reko')}
        </span>
        {assignedRekoPersonnel ? (
          // `title`: the whole value when the wider gutter (with an Auftrag) cuts it short
          <span
            className="min-w-0 flex-1 truncate text-sm"
            title={operation.rekoArrivedAt
              ? `${assignedRekoPersonnel.name} · ${t('card.onSiteSince', { time: formatClockTime(operation.rekoArrivedAt) })}`
              : assignedRekoPersonnel.name}
          >
            <PersonName name={assignedRekoPersonnel.name} personnelId={assignedRekoPersonnel.id} />
            {operation.rekoArrivedAt && (
              <span className="text-muted-foreground">
                {' · '}
                {t('card.onSiteSince', { time: formatClockTime(operation.rekoArrivedAt) })}
              </span>
            )}
          </span>
        ) : (
          // «keine», exactly like the three rows under it. It used to read
          // «Reko zuweisen» — the action written into the value slot, which
          // is the one place in the group where a value belongs. The action
          // is what the ROW is called now (title + aria-label above), which
          // is where the other three keep theirs.
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {t('detail.resourceEmpty')}
          </span>
        )}
        {/* No `group-hover` of its own — the row is the target, so it gets
            exactly one highlight. The chevron stays because it says this
            row LEADS somewhere (the Reko tab) rather than opening a picker
            in place, which is the one way it differs from its siblings. */}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
      </button>

    {/* Standalone, the resource rows share the Reko line's py-1 rhythm and
        follow it directly; grouped, the provenance blocks below bring
        their own `mt-4` frame. */}
    <div>
    {/* Mannschaft / Fahrzeuge / Material, grouped by WHERE THEY COME FROM.
        An Auftrag owns resources that ride on to the next stop; the stop
        itself can own resources that are released when it is finished.
        Both can be true at once, so both get a block of their own, headed
        once — instead of the Auftrag's name being repeated into every
        section title (mockup 08, Variante A). */}
    {auftrag && (
      <ResourceSourceBlock
        variant="route"
        title={t('detail.sourceAuftrag', { name: auftrag.name })}
        hint={t('detail.sourceAuftragHint')}
        accentColor={auftrag.color}
      >
        <RouteResourceSections
          resources={auftragResources ?? { vehicles: [], personnel: [], materials: [] }}
          // Same map the incident's own chips use: an Auftrag's vehicle is
          // no more self-explanatory than an incident's.
          vehicleDrivers={vehicleDrivers}
          onAssign={acceptsAssignments ? (resourceType) => onAssignResource?.(resourceType, operation.id) : undefined}
          onUnassign={(assignmentId) => void release.releaseRouteResource(auftrag.id, assignmentId)}
          onPromoteLeader={(assignmentId) => void promoteRouteLeader(auftrag.id, assignmentId)}
          onPickDriver={(v) => requestVehicleDriver({ vehicleId: v.resourceId, vehicleName: v.name })}
          onSetDriverStay={(assignmentId, driverStay) => void setRouteDriverStay(auftrag.id, assignmentId, driverStay)}
          driversKnown={vehicleDriversLoaded}
          readOnly={!canEdit || !onAssignResource}
        />
      </ResourceSourceBlock>
    )}

    {/* The incident's own. Without an Auftrag there is nothing to tell it
        apart from, so it renders bare and `ResourceSourceBlock` steps out
        of the way. */}
    {(!auftrag || hasOwnResources) && (
      <ResourceSourceBlock
        variant="incident"
        title={auftrag ? t('detail.sourceIncident') : undefined}
        hint={auftrag ? t('detail.sourceIncidentHint') : undefined}
      >
        {ownResources}
      </ResourceSourceBlock>
    )}

    </div>
    </div>
    </div>
  )
}

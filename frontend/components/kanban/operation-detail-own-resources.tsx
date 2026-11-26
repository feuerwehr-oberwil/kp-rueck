"use client"

import { useTranslations } from "next-intl"
import { Footprints, Layers, MapPin, Package, Truck, Undo2, UserMinus, Users } from 'lucide-react'
import { RemovableChip } from "@/components/ui/removable-chip"
import { LeaderBadge, LeaderGlyph } from "@/components/kanban/leader-badge"
import { PersonMenuSubtitle } from "@/components/kanban/chip-menu-subtitle"
import { PersonName, usePersonNaming } from "@/components/person-name"
import { CrewChipSlot, ResourceRow, RESOURCE_CHIP } from "@/components/kanban/route-resource-sections"
import { useVehicleChipMenu } from "@/components/kanban/vehicle-chip-menu"
import { type Material, type Operation, useOperations } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { type IncidentGroup } from "@/lib/contexts/groups-context"
import { usePromoteToLeader } from "@/lib/hooks/use-promote-to-leader"
import { type VehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { groupAssignedMaterials } from "@/lib/material-grouping"
import { sortCrewByLeader } from "@/lib/crew-order"
import { vehicleLabel } from "@/lib/vehicle-label"
import { cn } from "@/lib/utils"

/**
 * Mannschaft / Fahrzeuge / Material as assigned to THIS incident.
 *
 * Rendered in both shapes Übersicht knows: bare for a standalone Einsatz, and
 * inside the «Nur dieser Einsatz» block when the incident hangs in an Auftrag.
 *
 * That second home is the fix for a hole, not a decoration. Attaching an
 * incident to a route deliberately leaves its own assignments where they are
 * (see `crud/incidents.update_incident`), while the detail used to render the
 * route's roll-up *exclusively* — so everything assigned before the grouping
 * still existed in the database, still came back in the Rapport, and was
 * nowhere on screen. Nobody could see it, and nobody could release it.
 *
 * Grouped, only the types that actually hold something appear: this block is a
 * leftover to be worked off, not a place to add to, and «Fahrzeuge · 0» under
 * it would be a row of frame around nothing. Standalone, all three stay — that
 * is where an operator adds, and an empty section is the target.
 *
 * No add control while grouped, on purpose. Assigning from here has exactly
 * one sensible target, the Auftrag, and offering a second one would need the
 * assignment dialog to ask «Auftrag oder nur dieser Einsatz?» — a question the
 * dialog does not ask today.
 *
 * `OperationDetailContent` renders it as `OverviewForces`'s `ownResources`.
 */
export function OwnResourceSections({
  operation,
  auftrag,
  canEdit,
  acceptsAssignments,
  materials,
  vehicleDrivers,
  onUpdate,
  onAssignResource,
  onRemoveCrew,
  onRemoveVehicle,
  onRemoveMaterial,
}: {
  operation: Operation
  auftrag: IncidentGroup | undefined
  canEdit: boolean
  acceptsAssignments: boolean
  materials: Material[]
  vehicleDrivers: VehicleDrivers
  onUpdate: (updates: Partial<Operation>) => void
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string, search?: string) => void
  onRemoveCrew?: (operationId: string, personnelId: string) => void
  onRemoveVehicle?: (operationId: string, vehicleId: string) => void
  onRemoveMaterial?: (operationId: string, materialId: string) => void
}) {
  const t = useTranslations('kanban')
  const { requestVehicleDriver, toggleDriverStay } = useOperations()
  const vehicleChipMenu = useVehicleChipMenu()
  const { materialGroups } = useMaterials()
  // Promote a crew member to Einsatzleiter — shared with the card's chip menu.
  const promoteToLeader = usePromoteToLeader()
  const naming = usePersonNaming()
  const showEmptyOwnSections = !auftrag
  const ownAddAction = canEdit && onAssignResource && !auftrag && acceptsAssignments
  // The own crew's leader slot (`CrewChipSlot`): only where it can hold something –
  // never on a stop inside an Auftrag (the route leads), and on a read-only view only
  // while somebody actually leads.
  const ownCrewHasLeaderSlot = !auftrag && (canEdit || operation.crew.some(({ personnelId }) => personnelId === operation.leaderId))
  return (
    <>
      {/* Mannschaft (Crew) */}
      {(showEmptyOwnSections || operation.crew.length > 0) && (
        <ResourceRow
          icon={Users}
          label={t('common.crewCount', { count: operation.crew.length })}
          addLabel={ownAddAction ? t('common.assignCrew') : undefined}
          onAdd={ownAddAction ? () => onAssignResource?.('crew', operation.id) : undefined}
          isEmpty={operation.crew.length === 0}
          emptyLabel={t('detail.resourceEmpty')}
        >
          {/* EL first (decision 23) — the badge stays, this is ordering on top of it.
              The empty case is the row's own: `isEmpty` above draws «keine», and
              draws it as a button so the obvious thing to click is the thing
              that adds. */}
          {sortCrewByLeader(operation.crew, operation.leaderId).map(({ personnelId, name: member }) => {
              const isLeader = operation.leaderId === personnelId
              return (
                <CrewChipSlot
                  key={personnelId}
                  // The EL hangs in the slot before the chip (`CrewChipSlot`). A
                  // stop inside an Auftrag takes its leader from the route, so the
                  // badge – and with it the slot – is not offered on the stop's
                  // own crew: it would set a second, competing leader.
                  leader={
                    ownCrewHasLeaderSlot && (
                      <LeaderBadge
                        isLeader={isLeader}
                        onPromote={canEdit ? () => void promoteToLeader(operation, personnelId) : undefined}
                      />
                    )
                  }
                >
                  <RemovableChip
                    variant="secondary"
                    // No edge of its own for the Einsatzleiter: the EL badge says
                    // it, as on the card – the filled chip shows an edge only on
                    // hover/focus (hill climb r18).
                    className={RESOURCE_CHIP}
                    onRemove={canEdit && onRemoveCrew ? () => onRemoveCrew(operation.id, personnelId) : undefined}
                    removeTitle={t('detail.removePerson')}
                    removeButtonClassName="ml-1"
                    // Touch: the hover-only EL stub does not exist without a
                    // mouse, so promotion is a menu row — offered exactly where
                    // the stub is.
                    menuTitle={naming.inline({ name: member, personnelId })}
                    menuSubtitle={<PersonMenuSubtitle personnelId={personnelId} isLeader={!auftrag && isLeader} />}
                    menuActions={
                      !auftrag && canEdit && !isLeader
                        ? [{ label: t('leader.promote'), icon: <LeaderGlyph />, onSelect: () => void promoteToLeader(operation, personnelId) }]
                        : undefined
                    }
                    removeLabel={t('chipMenu.removeFromIncident')}
                    removeIcon={UserMinus}
                  >
                    <PersonName name={member} personnelId={personnelId} />
                  </RemovableChip>
                </CrewChipSlot>
              )
            })}
        </ResourceRow>
      )}

      {/* Fahrzeuge (Vehicles). «Zu Fuss» is a vehicle answer too, so a stop that
          carries only that still gets this row. */}
      {(showEmptyOwnSections || operation.vehicles.length > 0 || operation.zuFuss) && (
        <ResourceRow
          icon={Truck}
          label={t('common.vehiclesCount', { count: operation.vehicles.length })}
          // Opens the full assignment dialog, same as Mannschaft and Material.
          // This used to be an inline dropdown of the fleet — a second, poorer
          // vehicle picker without the driver info, «Zu Fuss» and the
          // free/spoken-for split the dialog carries (and its popover kept
          // colliding with the modal's close button). One picker, one behaviour.
          addLabel={ownAddAction ? t('common.assignVehicle') : undefined}
          onAdd={ownAddAction ? () => onAssignResource?.('vehicles', operation.id) : undefined}
          isEmpty={operation.vehicles.length === 0 && !operation.zuFuss}
          emptyLabel={t('detail.resourceEmpty')}
        >
          {operation.zuFuss && (
            <RemovableChip
              variant="secondary"
              className={RESOURCE_CHIP}
              onRemove={canEdit ? () => onUpdate({ zuFuss: false }) : undefined}
              removeTitle={t('common.removeZuFuss')}
              removeButtonClassName="ml-1"
              menuTitle={t('common.zuFuss')}
            >
              <Footprints className="h-3.5 w-3.5 shrink-0" />
              {t('common.zuFuss')}
            </RemovableChip>
          )}
          {operation.vehicles.map(({ vehicleId, name: vehicleName, callsign, driverStay, assignmentId }) => {
              const driver = vehicleDrivers.get(vehicleId)
              return (
                <RemovableChip
                  key={vehicleId}
                  variant="secondary"
                  // `shrink` to the row: a long «Name · Funkrufname (Fahrer) vor Ort»
                  // wraps inside its chip before the row's «+» column.
                  className={cn(RESOURCE_CHIP, "min-w-0 max-w-full shrink")}
                  title={callsign ? t('common.funkrufname', { callsign }) : undefined}
                  onRemove={canEdit && onRemoveVehicle ? () => onRemoveVehicle(operation.id, vehicleId) : undefined}
                  removeTitle={t('detail.removeVehicle')}
                  removeButtonClassName="ml-1"
                  menuTitle={vehicleName}
                  menuSubtitle={[
                    callsign,
                    driver && naming.inline(driver),
                    driverStay ? t('common.driverStaysFull') : t('common.driverReturnsFull'),
                  ].filter(Boolean).join(' · ')}
                  // A click on the chip opens its menu (owner pick 2B, 24.11.2026): the
                  // driver picker, the stay flag, «Fahrzeug freigeben».
                  menuActions={canEdit ? vehicleChipMenu({
                    driver,
                    onPickDriver: () => requestVehicleDriver({ vehicleId, vehicleName }),
                    driverStay: assignmentId ? !!driverStay : undefined,
                    onToggleStay: () => toggleDriverStay(operation.id, vehicleId),
                  }) : undefined}
                  mouseMenu={canEdit ? 'click' : undefined}
                >
                  {/* Two halves that wrap as wholes, like the card's vehicle chip
                      (card-resources.tsx): WHICH vehicle — «Name · Funkrufname» —
                      and, beneath it when the pair does not fit beside it, who
                      drives plus the stay toggle. Only the driver's name may
                      truncate (full name in `title`). */}
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1">
                  <span className="min-w-0 truncate">
                    {vehicleLabel({ name: vehicleName, callsign })}
                  </span>
                  {(driver || (canEdit && assignmentId)) && (
                  <span className="flex min-w-0 items-center">
                  {driver && (
                    <span className="min-w-0 truncate" title={naming.inline(driver)}>
                      (<PersonName name={driver.name} personnelId={driver.personnelId} />)
                    </span>
                  )}
                  {canEdit && assignmentId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleDriverStay(operation.id, vehicleId)
                      }}
                      // Neutral palette, a quiet state inside the chip. On the
                      // filled chip the «vor Ort» pill takes the ink tint the
                      // card's stay chip has (`bg-foreground/10`): `bg-muted`
                      // was the chip's own fill and vanished into it.
                      className={cn(
                        // `hit-area`: the 20px pill is a 26px target (globals.css).
                        "relative hit-area shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium transition-colors",
                        driver && "ml-1",
                        driverStay
                          ? "bg-foreground/10 text-foreground hover:bg-foreground/15"
                          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      )}
                      title={driverStay ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
                      tabIndex={-1}
                    >
                      {driverStay ? (
                        <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3 shrink-0" /> {t('common.driverStays')}</span>
                      ) : (
                        <span className="flex items-center gap-0.5"><Undo2 className="h-3 w-3 shrink-0" /> {t('common.driverReturns')}</span>
                      )}
                    </button>
                  )}
                  </span>
                  )}
                  </span>
                </RemovableChip>
              )
            })}
        </ResourceRow>
      )}

      {/* Material */}
      {(showEmptyOwnSections || operation.materials.length > 0) && (
        <ResourceRow
          icon={Package}
          label={t('common.materialsCount', { count: operation.materials.length })}
          addLabel={ownAddAction ? t('common.assignMaterial') : undefined}
          onAdd={ownAddAction ? () => onAssignResource?.('materials', operation.id) : undefined}
          isEmpty={operation.materials.length === 0}
          emptyLabel={t('detail.resourceEmpty')}
        >
          {(() => {
              const { completeGroups, ungrouped } = groupAssignedMaterials(operation.materials, materials, materialGroups)
              return (
                <>
                  {completeGroups.map(({ group, materialIds: matIds }) => (
                    <RemovableChip
                      key={`group-${group.id}`}
                      variant="secondary"
                      className={RESOURCE_CHIP}
                      onRemove={canEdit && onRemoveMaterial ? () => matIds.forEach((matId) => onRemoveMaterial(operation.id, matId)) : undefined}
                      removeTitle={t('common.removeNamed', { name: group.name })}
                      removeButtonClassName="ml-1"
                      menuTitle={group.name}
                      removeLabel={t('chipMenu.removeFromIncident')}
                    >
                      {/* h-3.5 like the «Zu Fuss» chip's glyph: both sit in a
                          `text-sm` chip, and 12px next to 14px text read as
                          two different chip families. */}
                      <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {group.name}
                    </RemovableChip>
                  ))}
                  {ungrouped.map((matId) => {
                    const mat = materials.find(m => m.id === matId)
                    return (
                      <RemovableChip
                        key={matId}
                        variant="secondary"
                        className={RESOURCE_CHIP}
                        onRemove={canEdit && onRemoveMaterial ? () => onRemoveMaterial(operation.id, matId) : undefined}
                        removeTitle={t('detail.removeMaterial')}
                        removeButtonClassName="ml-1"
                        menuTitle={mat?.name || matId}
                        menuSubtitle={mat?.category}
                        removeLabel={t('chipMenu.removeFromIncident')}
                      >
                        {mat?.name || matId}
                        {/* Origin/depot, e.g. "(Pio)" — shown here in the modal but
                            deliberately omitted on the kanban card to keep it clean. */}
                        {mat?.category && (
                          <span className="text-xs text-muted-foreground">({mat.category})</span>
                        )}
                      </RemovableChip>
                    )
                  })}
                </>
              )
            })()}
        </ResourceRow>
      )}
    </>
  )
}

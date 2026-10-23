"use client"

import { RemovableChip } from "@/components/ui/removable-chip"
import { LeaderBadge, LeaderGlyph } from "@/components/kanban/leader-badge"
import { PersonMenuSubtitle } from "@/components/kanban/chip-menu-subtitle"
import { useTranslations } from "next-intl"
import { Users, Package, Truck, AlertTriangle, Search, Footprints, MapPin, Undo2, Layers, Info, UserMinus } from 'lucide-react'
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { groupAssignedMaterials } from "@/lib/material-grouping"
import { sortCrewByLeader } from "@/lib/crew-order"
import { formatClockTime } from "@/lib/incident-time"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { cn } from "@/lib/utils"
import { usePromoteToLeader } from "@/lib/hooks/use-promote-to-leader"

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

interface CardResourcesProps {
  operation: Operation
  materials: Material[]
  /** Which rows render — decided by the card, because the card also needs the
   *  answer to place the RESSOURCEN rule (see `showResourceBlock` there). */
  showRekoPerson: boolean
  showCrewRow: boolean
  showVehicleRow: boolean
  showMaterialRow: boolean
  /** Vehicle name → driver, threaded in from the board (one roster call). */
  vehicleDrivers?: ReadonlyMap<string, string>
  /** Crew names assigned to >1 incident — drawn with conflict styling. */
  doubleBookedCrewNames?: Set<string>
  /** Editor gate: offers «Als Einsatzleiter markieren» in the crew chip menu. */
  canEdit: boolean
  onRemoveReko?: () => void
  onRemoveCrew: (crewName: string) => void
  onRemoveVehicle: (vehicleName: string) => void
  onToggleDriverStay?: (vehicleName: string) => void
  onToggleZuFuss?: () => void
  onRemoveMaterial: (materialId: string) => void
  /** The card's one way into the detail, and its event-stopping click variant. */
  openDetail: (tab?: OperationDetailTab, section?: OperationDetailSection) => void
  openDetailFrom: (tab: OperationDetailTab, section?: OperationDetailSection) => (event: React.MouseEvent) => void
}

/**
 * The rows of an Einsatz card's RESSOURCEN section: Reko person, crew chips,
 * vehicle rows and material groups. Rendered by `DraggableOperation` inside the
 * section's own wrapper (which owns the rule and the click target), and only
 * when at least one row shows.
 *
 * Deliberately NOT memoised: it re-renders whenever the card does, so the
 * card's `memo` comparator stays the one gate deciding when these rows repaint.
 * It reads the material groups, the on-site set and the leader action from
 * context itself, so the card body no longer subscribes to those.
 */
export function CardResources({
  operation,
  materials,
  showRekoPerson,
  showCrewRow,
  showVehicleRow,
  showMaterialRow,
  vehicleDrivers,
  doubleBookedCrewNames,
  canEdit,
  onRemoveReko,
  onRemoveCrew,
  onRemoveVehicle,
  onToggleDriverStay,
  onToggleZuFuss,
  onRemoveMaterial,
  openDetail,
  openDetailFrom,
}: CardResourcesProps) {
  const t = useTranslations('kanban')
  const { materialGroups } = useMaterials()
  const { materialOnSite } = useOperations()
  const promoteToLeader = usePromoteToLeader(operation)
  // How much of the crew row the counter is standing in for. Derived, not
  // props — `crew`/`materials` are already in the card's memo comparator.
  const hiddenCrewCount = showCrewRow ? Math.max(0, operation.crew.length - MAX_ROW_CHIPS) : 0

  return (
    <>
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
              // Touch: the tap that used to open the Reko tab is the
              // menu's first row now (see RemovableChip).
              menuTitle={operation.assignedReko.name.trim() || t('common.unknownResource')}
              menuSubtitle={<PersonMenuSubtitle name={operation.assignedReko.name} />}
              menuActions={[{ label: t('chipMenu.openDetails'), icon: <Info />, onSelect: () => openDetail('reko') }]}
              removeLabel={t('chipMenu.removeFromIncident')}
              removeIcon={UserMinus}
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
              // Touch only (the chip menu): the detail's rule and the
              // detail's handler — editors only, and not on whoever
              // already holds the role. (A stop inside an Auftrag, whose
              // leader is the route's, has no crew row on the card.)
              const canPromote = canEdit && operation.leaderName !== crewName
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
                  menuTitle={crewName.trim() || t('common.unknownResource')}
                  menuSubtitle={<PersonMenuSubtitle name={crewName} isLeader={operation.leaderName === crewName} />}
                  menuActions={[
                    { label: t('chipMenu.openDetails'), icon: <Info />, onSelect: () => openDetail('overview', 'resources') },
                    ...(canPromote
                      ? [{ label: t('leader.promote'), icon: <LeaderGlyph />, onSelect: () => void promoteToLeader(crewName) }]
                      : []),
                  ]}
                  removeLabel={t('chipMenu.removeFromIncident')}
                  removeIcon={UserMinus}
                >
                  {/* Leading chip glyphs are h-3 throughout the card (the
                      chip's own remove X stays at 2.5) and never shrink,
                      so a long name cannot squash them. */}
                  {isConflict && <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
                  {/* Read-only here: the card is a drag source, and the
                      badge only renders for whoever actually holds the
                      role, so the chip row stays as dense as it was.
                      With a mouse, promotion stays in the detail's EL
                      stub; on touch it is the chip menu's row above. */}
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
                menuTitle={t('common.zuFuss')}
                menuActions={[{ label: t('chipMenu.openDetails'), icon: <Info />, onSelect: () => openDetail('overview', 'resources') }]}
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
                menuTitle={vehicleName}
                menuSubtitle={[
                  callsign,
                  driverName,
                  driverStay ? t('common.driverStaysFull') : t('common.driverReturnsFull'),
                ].filter(Boolean).join(' · ')}
                menuActions={[{ label: t('chipMenu.openDetails'), icon: <Info />, onSelect: () => openDetail('overview', 'resources') }]}
                removeLabel={t('detail.removeVehicle')}
              >
                {/* min-w-0 so the NAME truncates while the status pill
                    (shrink-0 below) stays whole — a long
                    «Name · Funkrufname (Fahrer)» must never wrap the
                    chip onto a second line. Plain text, not a button:
                    the whole chip used to toggle the driver decision,
                    so reading who drives and CHANGING what he does
                    afterwards shared one click target. */}
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate">
                    {vehicleName}{callsign ? ` · ${callsign}` : ''}
                    {driverName && (
                      <span className="text-muted-foreground"> ({driverName})</span>
                    )}
                  </span>
                  {/* The only thing that toggles, and it says what
                      currently holds in full — «bleibt vor Ort» /
                      «fährt zurück». The short forms were a two-word
                      hint that only made sense next to the tooltip;
                      now that the chip text is no longer the click
                      target, the pill has the room for the sentence
                      that is read out on the radio and printed on the
                      slip. */}
                  <button
                    type="button"
                    aria-pressed={!!driverStay}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleDriverStay?.(vehicleName)
                    }}
                    disabled={!onToggleDriverStay}
                    title={driverStay ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-0.5 rounded px-1 type-micro transition-colors",
                      onToggleDriverStay && "cursor-pointer hover:brightness-110",
                      // Neutral ink in both states (quieter cards; the
                      // count-chip treatment, readable at 11px): the
                      // word and the pin/return icon say which.
                      "bg-foreground/10 text-foreground",
                    )}
                  >
                    {driverStay ? <MapPin className="h-2.5 w-2.5 shrink-0" /> : <Undo2 className="h-2.5 w-2.5 shrink-0" />}
                    {driverStay ? t('common.driverStaysFull') : t('common.driverReturnsFull')}
                  </button>
                </span>
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
                      menuTitle={group.name}
                      menuActions={[{ label: t('chipMenu.openDetails'), icon: <Info />, onSelect: () => openDetail('overview', 'resources') }]}
                      removeLabel={t('chipMenu.removeFromIncident')}
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
                        menuTitle={material?.name || materialId}
                        menuSubtitle={material?.category}
                        menuActions={[{ label: t('chipMenu.openDetails'), icon: <Info />, onSelect: () => openDetail('overview', 'resources') }]}
                        removeLabel={t('chipMenu.removeFromIncident')}
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
    </>
  )
}

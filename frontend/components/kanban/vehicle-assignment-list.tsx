"use client"

import { useTranslations } from "next-intl"
import { AlertTriangle, Footprints, MapPin, Undo2, Ban } from "lucide-react"
import { cn } from "@/lib/utils"
import { type VehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { usePersonNaming } from "@/components/person-name"
import { ElsewhereNote, ListSection, type OccupancyLabel, TileCheck, TILE_GRID, TILE_HOVER, TILE_META, TILE_META_ICON } from "@/components/kanban/assignment-list-section"
import { PICK_TILE } from "@/components/ui/picker-keys"

/** A vehicle as `ResourceAssignmentDialog` lists it. */
export type AssignableVehicle = { id: string; name: string; type: string; outOfService?: boolean }

/**
 * The vehicle half of `ResourceAssignmentDialog`: the free block («Zu Fuss» first), then the
 * spoken-for block. A vehicle is assigned on the tap, so each tile calls `onToggleVehicle`
 * directly; an assigned one carries the «bleibt vor Ort» / «kehrt zurück» switch. The dialog
 * keeps the sorting (the 1–9 keys need the same order) and the occupancy lookups.
 */
export function VehicleAssignmentList({
  free,
  busy,
  allBusyText,
  emptyReason,
  zuFuss,
  onToggleZuFuss,
  isVehicleAssigned,
  justAssigned,
  vehicleElsewhereLabel,
  vehicleDrivers,
  vehicleDriverStay,
  onToggleDriverStay,
  onToggleVehicle,
}: {
  free: AssignableVehicle[]
  busy: AssignableVehicle[]
  allBusyText: string | null
  emptyReason: 'none' | 'search' | 'filter' | null
  zuFuss: boolean
  onToggleZuFuss?: () => void
  isVehicleAssigned: (vehicleId: string) => boolean
  justAssigned: string | null
  vehicleElsewhereLabel: (vehicle: AssignableVehicle) => OccupancyLabel | null
  vehicleDrivers: VehicleDrivers
  vehicleDriverStay?: ReadonlyMap<string, boolean>
  onToggleDriverStay?: (vehicleId: string) => void
  onToggleVehicle: (vehicle: AssignableVehicle) => void
}) {
  const t = useTranslations('kanban')
  const naming = usePersonNaming()
  const allBusy = allBusyText !== null

  /** One vehicle row — shared by the free and the spoken-for block. */
  const renderVehicleTile = (vehicle: AssignableVehicle) => {
    const isAssigned = isVehicleAssigned(vehicle.id)
    const wasJustAssigned = justAssigned === vehicle.id
    // «Nicht einsatzbereit» beats everything: the row says so in a word and a
    // glyph and refuses the click. No error message — the target is simply not
    // grabbable, which is the same treatment the sidebar gives it.
    const isOutOfService = !!vehicle.outOfService && !isAssigned
    // Already on another incident/Auftrag → amber note with the
    // reference, matching the crew treatment (neutral tile, amber note).
    const elsewhere = vehicleElsewhereLabel(vehicle)
    // «bleibt vor Ort» vs «kehrt zurück». Assigning here used to
    // drop that decision on the floor: the flag exists from the
    // moment the vehicle is assigned (defaulting to «zurück»),
    // it is read out on the radio and printed on the slip, but
    // it could only be set from the incident card — so a whole
    // dispatch done through this dialog announced the wrong thing.
    const stays = vehicleDriverStay?.get(vehicle.id) ?? false
    const driver = vehicleDrivers.get(vehicle.id)
    const canSetStay = isAssigned && !!onToggleDriverStay
    return (
      <div
        key={vehicle.id}
        className={cn(
          "flex items-start gap-2 p-2.5 max-sm:py-3 rounded-lg border border-border/50 transition-colors",
          !isOutOfService && !isAssigned && TILE_HOVER,
          isAssigned && "border-sel-edge bg-sel-wash",
          isOutOfService && "border-dashed opacity-60"
        )}
      >
        <button
          {...PICK_TILE}
          onClick={() => onToggleVehicle(vehicle)}
          disabled={isOutOfService}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-3 text-left",
            isOutOfService ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {isOutOfService ? (
            <Ban className="mt-0.5 size-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <TileCheck checked={isAssigned} animate={wasJustAssigned} />
          )}
          <div className="min-w-0">
            <p className={cn("font-medium text-sm truncate", isOutOfService && "text-muted-foreground")} title={vehicle.name}>{vehicle.name}</p>
            {isOutOfService ? (
              <p className={cn(TILE_META, "truncate text-muted-foreground")}>
                {t('assignmentDialog.outOfService')}
              </p>
            ) : elsewhere ? (
              <ElsewhereNote label={elsewhere} />
            ) : (
              <p className="text-xs text-muted-foreground truncate">{vehicle.type}</p>
            )}
            {/* Whether anybody is driving it — the half of "TLF 1
                is free" the fleet list does not carry. Said in
                both directions on purpose: a silent row would
                leave "no driver" and "not loaded yet" looking
                the same on the one screen where it decides
                whether the vehicle can actually roll. */}
            <p
              className={cn(
                "flex items-start gap-1 truncate",
                driver ? "text-xs text-muted-foreground" : cn(TILE_META, "text-warning-foreground"),
              )}
              title={driver ? t('assignmentDialog.vehicleDriver', { name: naming.inline(driver) }) : undefined}
            >
              {/* Same amber triangle as the Auftrag's «Kein Fahrer» note — not
                  colour alone. Picking it anyway opens the driver prompt right
                  after (incident: performVehicleAssign, Auftrag: promptIfDriverless). */}
              {!driver && <AlertTriangle className={TILE_META_ICON} aria-hidden />}
              {driver
                ? t('assignmentDialog.vehicleDriver', { name: naming.inline(driver) })
                : t('assignmentDialog.vehicleNoDriver')}
            </p>
          </div>
        </button>
        {canSetStay && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleDriverStay(vehicle.id)
            }}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1.5 py-1 text-2xs font-medium transition-colors",
              stays
                ? "bg-foreground/10 text-foreground hover:bg-foreground/15"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
            title={stays ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
            aria-pressed={stays}
          >
            {stays ? <MapPin className="h-3 w-3" /> : <Undo2 className="h-3 w-3" />}
            {/* Full sentence here: this dialog is where the
                decision is MADE, and «bleibt» alone left the
                operator working out what the alternative was. */}
            {stays ? t('common.driverStaysFull') : t('common.driverReturnsFull')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* «Zu Fuss» and «Verfügbar · 0» go with a list a search or a
          filter emptied: next to «Keine Treffer» they read as the
          one hit. With truly no fleet, «Zu Fuss» is still a choice. */}
      {(free.length > 0 || allBusy ||
        (!!onToggleZuFuss && emptyReason !== 'search' && emptyReason !== 'filter')) && (
        <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: free.length })}>
          <div className={TILE_GRID}>
            {/* «Zu Fuss» is not a vehicle and is never spoken for,
                so it leads the free block. */}
            {onToggleZuFuss && (
              <button
                {...PICK_TILE}
                onClick={onToggleZuFuss}
                className={cn(
                  "flex cursor-pointer items-start gap-3 p-2.5 max-sm:py-3 rounded-lg border border-border/50 transition-colors text-left",
                  zuFuss ? "border-sel-edge bg-sel-wash" : TILE_HOVER
                )}
              >
                {/* The same tick box as every vehicle tile; the footprints
                    say what it is on the caption line, like a role glyph. */}
                <TileCheck checked={zuFuss} />
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{t('common.zuFuss')}</p>
                  <p className={cn(TILE_META, "flex items-start gap-1 truncate text-muted-foreground")}>
                    <Footprints className={TILE_META_ICON} aria-hidden />
                    {t('assignmentDialog.noVehicle')}
                  </p>
                </div>
              </button>
            )}
            {free.map(renderVehicleTile)}
          </div>
          {allBusy && <p className="mt-2 text-sm text-muted-foreground">{allBusyText}</p>}
        </ListSection>
      )}
      {busy.length > 0 && (
        <ListSection tone="busy" label={t('assignmentDialog.sectionBusy', { count: busy.length })}>
          <div className={TILE_GRID}>
            {busy.map(renderVehicleTile)}
          </div>
        </ListSection>
      )}
    </div>
  )
}

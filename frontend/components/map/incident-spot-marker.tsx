import type { Dispatch, RefObject, SetStateAction } from "react"
import type { Map as MlMap } from "maplibre-gl"
import { ChevronRight, Truck, Users } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { Operation } from "@/lib/contexts/operations-context"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { incidentZ } from "@/lib/map-view"
import { spotNumberText } from "@/lib/map-spots"
import type { LabelMode } from "@/lib/map-labels"
import type { ScreenBox } from "@/lib/map-vehicles"
import { IncidentLabel } from "./incident-label"
import { IncidentMarker, shortAddressOf } from "./incident-marker"
import { OperationHoverCard } from "./operation-hover-card"
import { SpotList } from "./spot-list"
import type { IncidentSpot } from "./use-pin-clusters"

/**
 * One address on the Lagekarte (`lib/map-spots.ts`): its pin and, when one shows, its label.
 * MapView renders one per spot that is not in a count bubble, with its own state passed in –
 * the hover, the open same-address list, the label passes' answers.
 */
export function IncidentSpotMarker({
  spot,
  map,
  compactMap,
  floating,
  selectedIncidentId,
  rekoSequence,
  hoveredSpotKey,
  handleHoverStart,
  handleHoverEnd,
  permanentLabels,
  fitLabelIds,
  leftLabelIds,
  effectiveMarkerAccents,
  openSpotKey,
  setOpenSpotKey,
  pickFromSpot,
  closeSpot,
  onMarkerClick,
  onMarkerDoubleClick,
  hoverCardsDisabled,
  operationsById,
  groups,
  groupResourcesFor,
  chromeBoxes,
  rootRef,
}: {
  spot: IncidentSpot
  map: MlMap | null
  compactMap: boolean
  /** The phone Lagekarte (MapView's `floating`). */
  floating: boolean
  selectedIncidentId: string | null | undefined
  /** Reko-Editor order: incident id → its number. */
  rekoSequence: ReadonlyMap<string, number>
  hoveredSpotKey: string | null
  handleHoverStart: (key: string) => void
  handleHoverEnd: (key: string) => void
  permanentLabels: LabelMode
  fitLabelIds: ReadonlySet<string>
  leftLabelIds: ReadonlySet<string>
  effectiveMarkerAccents: Map<string, string> | undefined
  openSpotKey: string | null
  setOpenSpotKey: Dispatch<SetStateAction<string | null>>
  pickFromSpot: (incidentId: string) => void
  closeSpot: () => void
  onMarkerClick: ((incidentId: string) => void) | undefined
  onMarkerDoubleClick: ((incidentId: string) => void) | undefined
  hoverCardsDisabled: boolean
  operationsById: Map<string, Operation> | undefined
  groups: IncidentGroup[] | undefined
  groupResourcesFor: ((groupId: string) => GroupResources) | undefined
  chromeBoxes: () => ScreenBox[]
  rootRef: RefObject<HTMLDivElement | null>
}) {
  const t = useTranslations('map')
  const incident = spot.lead
  const shared = spot.incidents.length > 1
  const selectedHere = spot.incidents.some((member) => member.id === selectedIncidentId)
  const isHighlighted = selectedHere || spot.incidents.some((member) => rekoSequence.has(member.id))
  // A shared pin shows the first number among its Einsätze.
  const sequence = spot.incidents.reduce<number | undefined>((first, member) => {
    const n = rekoSequence.get(member.id)
    return n !== undefined && (first === undefined || n < first) ? n : first
  }, undefined)
  const pointedAt = hoveredSpotKey === spot.key
  const shortAddress = shortAddressOf(incident)
  // A permanent label by the surface's rule — or this pin's own, because it is the
  // selected one (a phone's only way to read a label at the default zoom).
  const permanent =
    permanentLabels === "all" || (permanentLabels === "fit" && fitLabelIds.has(spot.key))
  const side = permanent && leftLabelIds.has(spot.key) ? "left" : "right"
  const hoverStart = () => handleHoverStart(spot.key)
  const hoverEnd = () => handleHoverEnd(spot.key)
  const accentColor = effectiveMarkerAccents?.get(incident.id) ?? null

  if (shared) {
    // Several Einsätze at this address: the lead's pin + count, ONE label with the
    // numbers, and the list to pick one – open after a click or tap on the pin and, with
    // a mouse, while pointed at or while one of them is selected. The phone's list is
    // docked at the map's foot (rendered by MapView, outside the map).
    const open = openSpotKey === spot.key || (!compactMap && (selectedHere || pointedAt))
    const numbers = spotNumberText(spot.incidents)
    const allNumbers = spot.incidents.flatMap((member) => (member.number != null ? [member.number] : []))
    const ariaLabel =
      allNumbers.length > 0
        ? t("view.spotAria", { count: spot.incidents.length, numbers: allNumbers.join(", "), address: shortAddress })
        : t("view.spotAriaNoNumbers", { count: spot.incidents.length, address: shortAddress })
    const toggle = () => setOpenSpotKey((current) => (current === spot.key ? null : spot.key))
    // A double-click is two clicks: the list stays open, and the map does not zoom.
    const keepOpen = () => setOpenSpotKey(spot.key)
    return (
      <>
        <IncidentMarker
          incident={incident}
          highlighted={isHighlighted}
          compact={compactMap}
          accentColor={accentColor}
          sequence={sequence}
          count={spot.incidents.length}
          ariaLabel={ariaLabel}
          expanded={open}
          zIndex={incidentZ("pin", incident.priority, { hovered: pointedAt || open, highlighted: isHighlighted })}
          onSelect={toggle}
          onOpen={keepOpen}
          onHoverStart={hoverStart}
          onHoverEnd={hoverEnd}
        />
        {(permanent || open || selectedHere) && (
          <IncidentLabel
            latitude={spot.latitude}
            longitude={spot.longitude}
            side={side}
            selected={selectedHere}
            zIndex={incidentZ("label", incident.priority, { hovered: pointedAt || open, highlighted: isHighlighted })}
            onSelect={toggle}
            onOpen={keepOpen}
            onHoverStart={hoverStart}
            onHoverEnd={hoverEnd}
            below={
              open && !compactMap && (
                <SpotList
                  spot={spot}
                  address={shortAddress}
                  selectedId={selectedHere ? selectedIncidentId ?? null : null}
                  docked={false}
                  onPick={onMarkerClick ? pickFromSpot : undefined}
                  onOpen={onMarkerDoubleClick}
                  onClose={closeSpot}
                />
              )
            }
          >
            {numbers && <span className="mr-1 font-mono text-2xs font-medium text-muted-foreground">{numbers}</span>}
            <span className="font-semibold">{shortAddress}</span>
          </IncidentLabel>
        )}
      </>
    )
  }

  // Hover shows the full picture (type, status, crew, reko, …) via the Operation lookup;
  // the permanent label stays short. Token/display mode has no operations — labels stay
  // short there. A CLICK pins the same card: selecting a marker holds the detail open
  // until the marker is clicked again (deselect).
  const pinned = selectedHere
  const hovered = pointedAt || pinned
  const hoverOperation =
    hovered && !hoverCardsDisabled ? operationsById?.get(incident.id) : undefined
  // An Auftrag stop owns no resources of its own — they ride on the route — so resolve
  // them here too, not just on the numbered route pins. Same incident, same answer,
  // whichever you hover.
  const hoverGroup = hoverOperation?.groupId
    ? groups?.find((g) => g.id === hoverOperation.groupId)
    : undefined
  // A share-link payload has no number; the board's incidents do.
  const incidentNumber = "number" in incident ? incident.number : null
  // Split, not summed: a bare "(3)" hid whether that was three people,
  // three vehicles or a mix — an icon each answers it without a click.
  const vehicleCount = incident.assigned_vehicles.length
  const personnelCount = incident.crewCount
  const select = () => onMarkerClick?.(incident.id)
  const openDetail = onMarkerDoubleClick ? () => onMarkerDoubleClick(incident.id) : undefined

  return (
    <>
      <IncidentMarker
        incident={incident}
        highlighted={isHighlighted}
        compact={compactMap}
        accentColor={accentColor}
        sequence={sequence}
        // Two markers a few metres apart overlap; the one being pointed at (or
        // selected) belongs on top, the rest by priority – not by DOM order – and
        // above every resting label (see Z in lib/map-view.ts).
        zIndex={incidentZ("pin", incident.priority, { hovered: pointedAt, highlighted: isHighlighted })}
        onSelect={select}
        onOpen={openDetail}
        onHoverStart={hoverStart}
        onHoverEnd={hoverEnd}
      />

      {/* No permanent label: hovering still reveals the detail card when we can resolve
          the operation, and the selected incident always shows its label/card. */}
      {(permanent || pinned || hoverOperation) && (
        <IncidentLabel
          latitude={spot.latitude}
          longitude={spot.longitude}
          side={permanent ? side : "right"}
          // The card keeps clear of the open legend (VIS.18). Only a pinned card: a
          // hover card that flipped left as it grew slid out from under the pointer,
          // whose «leave» closed it (Sol review H). Not on the phone: there the camera
          // brings pin + card into view (`usePanToSelected`), card on the right.
          fit={pinned && hoverOperation && !compactMap && map ? { map, chrome: chromeBoxes, root: rootRef } : undefined}
          selected={pinned}
          zIndex={incidentZ("label", incident.priority, { hovered, highlighted: isHighlighted })}
          onSelect={select}
          onOpen={openDetail}
          onHoverStart={hoverStart}
          onHoverEnd={hoverEnd}
        >
          {hoverOperation ? (
            <OperationHoverCard
              operation={hoverOperation}
              routeName={hoverGroup?.name}
              routeResources={hoverGroup && groupResourcesFor?.(hoverGroup.id)}
            />
          ) : (
            <>
              {/* Mono 11 number, Sora 12/600 address – the list rail's pairing. */}
              {incidentNumber != null && (
                <span className="mr-1 font-mono text-2xs font-medium text-muted-foreground">{incidentNumber}</span>
              )}
              {/* Its own element: the address is what a label is found by. */}
              <span className="font-semibold">{shortAddress}</span>
              {/* Crew counters: 12px glyph + 11/500 count, 3px inside a pair, 6px
                  between pairs. `align-top` + the line's own 18px height centres them
                  on the address line instead of sitting them on its baseline.
                  `estimateLabelWidth` (lib/map-labels.ts) assumes this geometry. */}
              {(vehicleCount > 0 || personnelCount > 0) && (
                <span
                  className="ml-1.5 inline-flex h-[18px] items-center gap-1.5 align-top text-2xs font-medium text-muted-foreground"
                  title={t('view.crewSummary', { vehicles: vehicleCount, personnel: personnelCount })}
                >
                  {vehicleCount > 0 && (
                    <span className="inline-flex items-center gap-[3px]">
                      <Truck className="size-3" aria-hidden />
                      {vehicleCount}
                    </span>
                  )}
                  {personnelCount > 0 && (
                    <span className="inline-flex items-center gap-[3px]">
                      <Users className="size-3" aria-hidden />
                      {personnelCount}
                    </span>
                  )}
                </span>
              )}
            </>
          )}
          {/* The pinned card's visible way in: double-click and Enter are not written
              anywhere on it. Same word as the list rail's icon. Inside the bubble, so it
              sits under whatever the card shows (crew, notes) and the selected-label
              measure (`usePanToSelected`) includes it. Its click is its own, not a
              second select. */}
          {pinned && openDetail && !floating && (
            <div className="mt-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation()
                  openDetail()
                }}
              >
                {t("page.showDetails")}
                <ChevronRight />
              </Button>
            </div>
          )}
        </IncidentLabel>
      )}
    </>
  )
}

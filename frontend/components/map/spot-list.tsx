/** A same-address pin's list of incidents (`SpotList`), hung under its label or docked at the
 *  phone map's foot by MapView. */

import { X } from "lucide-react"
import { useTranslations } from "next-intl"
import { IncidentNumber } from "@/components/ui/incident-number"
import type { MapIncident } from "@/lib/map-incident"
import { PRIORITY_MARKER_COLORS } from "@/lib/map-colors"
import { priorityGlyphPath } from "@/lib/map-priority"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import type { IncidentSpot } from "./use-pin-clusters"
import { useOpenOnDoubleClick } from "./use-open-on-double-click"

/** «Hohe Priorität» & co. for an accessible name – the glyph alone says nothing to a reader. */
export function priorityName(t: ReturnType<typeof useTranslations<"map">>, priority: string | null | undefined): string {
  return priority === "high" ? t("common.priorityHigh") : priority === "medium" ? t("common.priorityMedium") : t("common.priorityLow")
}

/**
 * The list under a same-address label (look 3B): the address, then one row per incident –
 * priority glyph, number, Meldung (else Einsatzart), status. A row click is a click on that incident's pin (select;
 * in Reko-Editor / Auftrags-Editor: assign / add it), a double-click opens it. The selected one is
 * marked. Desktop: hung under the label while the pin or its label is pointed at, after a click
 * on the pin, and while one of its incidents is selected. Phone (`docked`): after a tap on the
 * pin, docked along the map's bottom edge – a 320px list off a pin does not fit a 390px map –
 * with a ✕.
 */
export function SpotList({
  spot,
  address,
  selectedId,
  docked,
  onPick,
  onOpen,
  onClose,
}: {
  spot: IncidentSpot
  address: string
  selectedId: string | null
  docked: boolean
  onPick?: (incidentId: string) => void
  onOpen?: (incidentId: string) => void
  onClose: () => void
}) {
  const t = useTranslations("map")
  return (
    <div
      role="group"
      aria-label={address}
      className={`rounded-lg border border-border bg-popover py-1.5 font-sans text-sm text-popover-foreground shadow-lg ${
        docked ? "absolute inset-x-2 bottom-2 z-map-control flex max-h-[calc(100%-1rem)] flex-col" : "w-80"
      }`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose()
      }}
    >
      <div className="flex shrink-0 items-start gap-2 px-3 pb-1 pt-0.5">
        <p className="min-w-0 flex-1 break-words font-semibold">{address}</p>
        {docked && (
          <button
            type="button"
            className="-mr-1.5 -mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
            aria-label={t("view.spotClose")}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Docked, the rows scroll under the address and the ✕ once they outgrow the map (six
          incidents at one address on a phone). */}
      <div className={docked ? "relative min-h-0 overflow-y-auto overscroll-contain" : undefined}>
        {spot.incidents.map((incident) => (
          <SpotListRow
            key={incident.id}
            incident={incident}
            selected={incident.id === selectedId}
            onPick={onPick}
            onOpen={onOpen}
          />
        ))}
      </div>
      {/* The one thing a row cannot show by itself: a double-click opens it. A finger has no
          double-click here – the selected Einsatz opens from the page's own card. */}
      {!docked && onOpen && (
        <p className="mt-1 border-t border-border px-3 pt-1.5 text-xs text-muted-foreground">{t("view.spotHint")}</p>
      )}
    </div>
  )
}

/** One row of `SpotList`. */
function SpotListRow({
  incident,
  selected,
  onPick,
  onOpen,
}: {
  incident: MapIncident
  selected: boolean
  onPick?: (incidentId: string) => void
  onOpen?: (incidentId: string) => void
}) {
  const t = useTranslations("map")
  const tKanban = useTranslations("kanban")
  const doubleClickRef = useOpenOnDoubleClick(onOpen ? () => onOpen(incident.id) : undefined)
  const color = PRIORITY_MARKER_COLORS[incident.priority] ?? PRIORITY_MARKER_COLORS.low
  // What tells them apart at one address: the Meldung, else the Einsatzart. Not the title – that
  // is the address again (the board shows it only where an address is missing).
  const what = incident.description?.trim() || getIncidentTypeLabel(incident.type)
  return (
    <div ref={doubleClickRef}>
      <button
        type="button"
        aria-current={selected || undefined}
        className={`grid w-full grid-cols-[14px_auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1 text-left leading-5 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none pointer-coarse:min-h-11 ${
          selected ? "bg-sel-wash shadow-[inset_2px_0_0_var(--sel-line)]" : ""
        }`}
        onClick={() => onPick?.(incident.id)}
      >
        <svg width={14} height={14} viewBox="0 0 14 14" role="img" aria-label={priorityName(t, incident.priority)}>
          <path
            d={priorityGlyphPath(incident.priority, 7, 7, 1.2)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <IncidentNumber number={incident.number} className="text-xs" />
        <span className="truncate" title={what}>{what}</span>
        <span className="text-xs text-muted-foreground">{tKanban(`columns.${incident.status}`)}</span>
      </button>
    </div>
  )
}

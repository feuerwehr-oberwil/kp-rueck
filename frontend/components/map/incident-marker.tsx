/** The incident dot and its map marker – MapView draws one per address (`IncidentSpotMarker`). */

import { Marker } from "react-map-gl/maplibre"
import { useTranslations } from "next-intl"
import { shortAddressOf, type LocatedIncident, type MapIncident } from "@/lib/map-incident"
import { STATUS_TO_GROUP, STATUS_GROUP_BORDER_STYLE } from "@/lib/types/incidents"
import { PRIORITY_MARKER_COLORS, STATUS_RING, incidentPinRings, incidentPinSize } from "@/lib/map-colors"
import { markerGlyphInk, priorityGlyphPath } from "@/lib/map-priority"
import { PinCountBadge } from "./pin-count-badge"
import { useOpenOnDoubleClick } from "./use-open-on-double-click"

/**
 * One incident's dot: priority (or «Färben nach») fill, white ring, and an outer ring whose
 * DASH STYLE — solid / dashed / dotted — carries the status group. Never colour alone: the
 * board's priority chevron / dash sits in the fill (`lib/map-priority.ts`), under any colouring.
 */
function IncidentPin({
  incident,
  highlighted,
  compact,
  accentColor,
  sequence,
  ariaLabel,
  expanded,
  onActivate,
}: {
  incident: MapIncident
  highlighted: boolean
  /** Its place in the selected Reko person's order (Reko-Editor): the number replaces the
   *  priority glyph, as the Auftrag pins carry theirs (mock 2a, 19.11.2026). */
  sequence?: number
  /** Phone geometry (`STATUS_RING.phone`): 3px frame, spaced dashes / round dots. */
  compact: boolean
  accentColor?: string | null
  /** A same-address pin names all of its incidents (`view.spotAria`); default: this one. */
  ariaLabel?: string
  /** A same-address pin: whether its list is open. */
  expanded?: boolean
  onActivate: () => void
}) {
  const t = useTranslations('map')
  // When a "Färben nach" dimension is active, the marker fill is overridden with
  // that group's colour; otherwise it falls back to the priority colour.
  const priorityColor =
    PRIORITY_MARKER_COLORS[incident.priority] ?? PRIORITY_MARKER_COLORS.low
  const fillColor = accentColor || priorityColor
  const size = incidentPinSize(highlighted, compact)

  const statusGroup = STATUS_TO_GROUP[incident.status] || 'open'
  const borderStyle = STATUS_GROUP_BORDER_STYLE[statusGroup]
  const rings = incidentPinRings(size, compact, statusGroup)

  // D8: tabbable + screen-reader-friendly marker. Enter/Space activate it directly now —
  // under Leaflet the icon was an HTML string, so the key had to be caught on the map wrapper
  // and re-dispatched as a synthetic click.
  const a11yLabel = incident.number != null ? `${incident.number} · ${shortAddressOf(incident)}` : shortAddressOf(incident)
  const shadowId = `marker-shadow-${incident.id}`

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel ?? t('view.markerAria', { label: a11yLabel })}
      aria-expanded={expanded}
      // Highlighted = bigger plus the shared two-beat ink ring (`this-one-ring`, COL-05 A) – the
      // board's «this one». It was a blue halo, the colour of an Auftrag.
      className={highlighted ? "this-one-ring" : undefined}
      style={{ display: "block", transition: "all 0.2s ease", opacity: borderStyle.opacity, borderRadius: "50%", ...(highlighted ? {} : { outline: "none" }) }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        onActivate()
      }}
    >
      <defs>
        <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy={highlighted ? 2 : 1}
            stdDeviation={highlighted ? 2 : 1}
            floodOpacity={highlighted ? 0.4 : 0.25}
          />
        </filter>
      </defs>

      {/* Priority fill circle with white border */}
      <circle
        cx={rings.r}
        cy={rings.r}
        r={rings.fillR}
        fill={fillColor}
        stroke="white"
        strokeWidth={rings.halo}
        filter={`url(#${shadowId})`}
      />

      {/* Priority glyph: ▲ Hoch, – Mittel, ▼ Niedrig, as on the board's cards – or, in the
          Reko-Editor, the pin's number in its person's order. */}
      {sequence !== undefined ? (
        <text
          x={rings.r}
          y={rings.r}
          textAnchor="middle"
          dominantBaseline="central"
          fill={markerGlyphInk(fillColor)}
          fontSize={size * 0.42}
          fontWeight={700}
        >
          {sequence}
        </text>
      ) : (
        <path
          d={priorityGlyphPath(incident.priority, rings.r, rings.r, size / 24)}
          fill="none"
          stroke={markerGlyphInk(fillColor)}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Status border ring (outer) */}
      <circle
        cx={rings.r}
        cy={rings.r}
        r={rings.ringR}
        fill="none"
        stroke={STATUS_RING.color}
        strokeWidth={rings.ringWidth}
        strokeDasharray={rings.dasharray}
        strokeLinecap={rings.linecap}
      />
    </svg>
  )
}

/** The incident dot as a map marker – or a same-address pin, which is its lead's dot plus a count
 *  badge (`count`). A component for readability only – the hover state lives in the parent, so
 *  hovering one marker re-renders them all. Fine at a board's handful of pins. */
export function IncidentMarker({
  incident,
  highlighted,
  compact,
  accentColor,
  sequence,
  count = 1,
  ariaLabel,
  expanded,
  zIndex,
  onSelect,
  onOpen,
  onHoverStart,
  onHoverEnd,
}: {
  incident: LocatedIncident
  highlighted: boolean
  /** Phone geometry – see IncidentPin. */
  compact: boolean
  accentColor?: string | null
  /** Reko-Editor order number – see IncidentPin. */
  sequence?: number
  /** Incidents at this spot: from 2 on the pin wears the count badge. */
  count?: number
  ariaLabel?: string
  expanded?: boolean
  zIndex: number
  onSelect: () => void
  /** Double-click: open the Einsatz (see useOpenOnDoubleClick). */
  onOpen?: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
}) {
  const size = incidentPinSize(highlighted, compact)
  const doubleClickRef = useOpenOnDoubleClick(onOpen)
  return (
    <Marker
      longitude={incident.location_lng}
      latitude={incident.location_lat}
      style={{ zIndex }}
      // A click on a DOM marker also reaches the map canvas under it (Leaflet swallowed it),
      // where it would count as an empty-map click and add a route stop.
      onClick={(event) => {
        event.originalEvent.stopPropagation()
        onSelect()
      }}
    >
      <div
        ref={doubleClickRef}
        style={{ position: "relative", width: size, height: size }}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
      >
        <IncidentPin
          incident={incident}
          highlighted={highlighted}
          compact={compact}
          accentColor={accentColor}
          sequence={sequence}
          ariaLabel={ariaLabel}
          expanded={expanded}
          onActivate={onSelect}
        />
        {count > 1 && <PinCountBadge count={count} />}
      </div>
    </Marker>
  )
}

import { type Operation, type OperationStatus } from "./contexts/operations-context"
import { getIncidentTypeLabel } from "./incident-types"
import { PRIORITY_COLORS, PRIORITY_LABELS } from "./priority"
import { INCIDENT_TYPE_MARKER_COLORS } from "./map-colors"

/**
 * The one status colour table.
 *
 * Two of these screens hang on the same wall in a command post, so a status
 * that is emerald on one and sky on the next is an operational defect, not a
 * cosmetic one. Everything that colours BY STATUS reads from here: the board's
 * column backgrounds, the wall display's status sections and dots, and the
 * route-stop rows (which collapse seven statuses onto five — see
 * `StopMirrorStatus` — but must use the colour of the column they mirror).
 *
 * The board wins. These are the hues the kanban columns have always carried,
 * and the surfaces that disagreed were changed to match, not the other way
 * round: `active` was amber on route stops (colliding with `warning`, i.e.
 * medium priority and «Am Warten»), `returning` and `complete` were both
 * emerald (colliding with «frei / verfügbar» and with the Reko column).
 *
 * Full class strings on purpose — Tailwind scans source text, so a hue
 * assembled from a variable would not be generated.
 */
export const STATUS_ACCENT: Record<OperationStatus, {
  /** Column header / section background tint. */
  surface: string
  /** Left edge, where an edge means status (route-stop rows). Never on an
   *  incident CARD — there the left edge means priority. */
  border: string
  /** Text and icon tint. */
  text: string
  /** Filled dot beside a row. */
  dot: string
}> = {
  incoming: {
    surface: "bg-slate-200/80 dark:bg-slate-800/70",
    border: "border-l-slate-500",
    text: "text-slate-600 dark:text-slate-400",
    dot: "bg-slate-500",
  },
  reko: {
    surface: "bg-emerald-100/80 dark:bg-emerald-950/70",
    border: "border-l-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  reko_done: {
    surface: "bg-teal-100/80 dark:bg-teal-950/70",
    border: "border-l-teal-500",
    text: "text-teal-600 dark:text-teal-400",
    dot: "bg-teal-500",
  },
  enroute: {
    surface: "bg-blue-100/80 dark:bg-blue-950/70",
    border: "border-l-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  active: {
    surface: "bg-orange-100/80 dark:bg-orange-950/70",
    border: "border-l-orange-500",
    text: "text-orange-600 dark:text-orange-400",
    dot: "bg-orange-500",
  },
  returning: {
    surface: "bg-sky-100/80 dark:bg-sky-950/70",
    border: "border-l-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500",
  },
  complete: {
    surface: "bg-gray-200/80 dark:bg-zinc-900/70",
    border: "border-l-zinc-500",
    text: "text-zinc-600 dark:text-zinc-400",
    dot: "bg-zinc-500",
  },
}

// Kanban column definitions
// Colors come from STATUS_ACCENT — see there for why they are what they are.
//
// `id` IS a status: since database, API and board share one vocabulary there is
// nothing left to translate, and typing it as `OperationStatus` is what keeps
// `t(`kanban.columns.${column.id}`)` provably inside the message block — that
// lookup resolves at runtime, so nothing else would notice a typo.
export const columns: Array<{
  id: OperationStatus
  title: string
  status: OperationStatus[]
  color: string
  collapsible?: boolean
}> = [
  { id: "incoming", title: "EINGEGANGEN", status: ["incoming"], color: STATUS_ACCENT.incoming.surface },
  { id: "reko", title: "REKO", status: ["reko"], color: STATUS_ACCENT.reko.surface },
  { id: "reko_done", title: "REKO ABGESCHLOSSEN", status: ["reko_done"], color: STATUS_ACCENT.reko_done.surface },
  { id: "enroute", title: "DISPONIERT / ANFAHRT", status: ["enroute"], color: STATUS_ACCENT.enroute.surface },
  { id: "active", title: "EINSATZ", status: ["active"], color: STATUS_ACCENT.active.surface },
  { id: "returning", title: "BEENDET / RÜCKFAHRT", status: ["returning"], color: STATUS_ACCENT.returning.surface },
  { id: "complete", title: "ABGESCHLOSSEN", status: ["complete"], color: STATUS_ACCENT.complete.surface, collapsible: true },
]

// ── Map marker coloring ("Färben nach") ──────────────────────────────────────
// Re-colors the map's incident markers by a chosen dimension so the operator can
// group visually (e.g. all incidents handled by one Reko person share a colour).
// 'priority' is the default and keeps the original semantic priority colours.
export type ColorByDimension = "priority" | "reko" | "vehicle" | "type" | "auftrag"

export interface ColorGroup {
  key: string
  label: string
  color: string
}

/** Minimal Auftrag (incident group) shape needed to colour by route — the
 *  incident carries only `groupId`, so name + colour are looked up from here. */
export interface ColorGroupSource {
  id: string
  name: string
  color?: string | null
}

// Labels for the "Färben nach" dimensions live in messages under `map.colorBy.*`.

// Neutral grey for incidents with no value in the active dimension (e.g. no
// Reko/vehicle assigned yet) — surfaced as an "Ohne Zuweisung" legend entry.
export const COLOR_NONE = "#9ca3af"

// localStorage key for the persisted board/map coloring choice.
export const COLOR_BY_STORAGE_KEY = "kp-board-colorBy"

// Distinct, high-contrast hues for categorical dimensions (reko/vehicle/type).
const ACCENT_PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#0ea5e9",
  "#84cc16", "#f43f5e",
]
// Priority keeps its semantic colours instead of a hashed hue — shared with
// the map markers and display board so the same priority never changes colour
// between views.
const PRIORITY_ACCENTS: Record<string, string> = PRIORITY_COLORS

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function colorAccent(
  key: string,
  dimension: ColorByDimension,
  groups?: ColorGroupSource[],
): string {
  if (dimension === "priority") return PRIORITY_ACCENTS[key] ?? "#64748b"
  // Einsatzart has a MEANING, so it gets a table rather than the hashed fallback below. An
  // unknown//custom type still hashes, so a station that adds one is not left colourless.
  if (dimension === "type") {
    const known = INCIDENT_TYPE_MARKER_COLORS[key]
    if (known) return known
  }
  // Aufträge use the route's own colour (matches the map polylines) so a route
  // reads the same across the board, list and markers; hashed hue is a fallback.
  if (dimension === "auftrag") {
    const g = groups?.find((gr) => gr.id === key)
    if (g?.color) return g.color
  }
  return ACCENT_PALETTE[hashString(key) % ACCENT_PALETTE.length]
}

/** The colour group an operation belongs to for the chosen dimension, or null
 *  when it has no value there (e.g. no Reko / no Auftrag assigned). For the
 *  "auftrag" dimension pass the event's groups so the label/colour resolve to
 *  the route's name + colour. */
export function colorGroupFor(
  operation: Operation,
  dimension: ColorByDimension,
  groups?: ColorGroupSource[],
): ColorGroup | null {
  let key: string | undefined
  let label: string | undefined
  switch (dimension) {
    case "reko":
      key = operation.assignedReko?.id
      label = operation.assignedReko?.name
      break
    case "vehicle":
      key = operation.vehicles[0]
      label = operation.vehicles[0]
      break
    case "type":
      key = operation.incidentType
      label = operation.incidentType ? getIncidentTypeLabel(operation.incidentType) : undefined
      break
    case "priority":
      key = operation.priority || "low"
      label = PRIORITY_LABELS[key as keyof typeof PRIORITY_LABELS] ?? key
      break
    case "auftrag":
      key = operation.groupId ?? undefined
      label = key ? groups?.find((gr) => gr.id === key)?.name : undefined
      break
    default:
      return null
  }
  if (!key) return null
  return { key, label: label ?? key, color: colorAccent(key, dimension, groups) }
}

// Stop-row status accent — the four "mirror" columns a route stop can be in
// (Offen / Disponiert / Einsatz / Beendet). The left-border colour matches the
// StopStatusControl icon colours so a Reihenfolge row carries the same status
// meaning as the board column it mirrors.
export type StopMirrorStatus = "incoming" | "enroute" | "active" | "returning" | "complete"

/**
 * The Auftrag a stop belongs to — by the incident's own `groupId` when it has
 * one, otherwise by the routes' `stopIds`.
 *
 * The fallback is the load-bearing half. `groupId` is server state on the
 * INCIDENT, while adding a stop writes the ROUTE: `addStopsToGroup` updates the
 * groups context and the incident's `group_id` only arrives with the next
 * operations refresh. In that window a freshly added stop looked ungrouped, and
 * three things went wrong at once — it was announced as a lone «neuer Einsatz»
 * instead of the Auftragsdurchsage, «es fehlt noch etwas» offered to assign to
 * the incident rather than to the route, and the route's own crew and vehicles
 * were not counted when deciding what was missing. A route's stopIds are
 * authoritative for membership, so ask them.
 */
export function findAuftragForStop<G extends { id: string; stopIds: string[] }>(
  groups: G[],
  operation: { id: string; groupId: string | null } | null | undefined,
): G | undefined {
  if (!operation) return undefined
  if (operation.groupId) {
    const byId = groups.find((group) => group.id === operation.groupId)
    if (byId) return byId
  }
  return groups.find((group) => group.stopIds.includes(operation.id))
}

/**
 * Label key under `kanban.stopStatus` for each mirror column.
 *
 * The German key names stay German on purpose. They are NOT status values — the
 * route stops collapse seven statuses onto five coarser mirror columns whose
 * wording (Offen / Beendet / Abgeschlossen) has no 1:1 counterpart in the status
 * vocabulary. This map is that deliberate collapse, not a translation table.
 */
export const STOP_STATUS_LABEL_KEY: Record<StopMirrorStatus, string> = {
  incoming: "offen",
  enroute: "disponiert",
  active: "einsatz",
  returning: "beendet",
  complete: "abgeschlossen",
}

/** Text tint for a stop status — the colour of the board column this mirror
 *  status stands for (STATUS_ACCENT), so a Reihenfolge row, the wall display and
 *  the board never disagree about what «Einsatz» or «Beendet» looks like. Kept
 *  here so a consumer that only needs the colour does not pull in the
 *  drag-heavy route-stop-list module. */
export function stopStatusTextClass(status: StopMirrorStatus): string {
  return STATUS_ACCENT[status].text
}

/** Left edge of a route-stop ROW, which — unlike an incident card — means
 *  status: a stop row lives in a route, not in a status column, so nothing else
 *  on it says which column it mirrors. */
export function stopStatusBorderClass(status: StopMirrorStatus): string {
  return STATUS_ACCENT[status].border
}

/** Collapse an incident's full status onto one of the four route-stop mirror
 *  columns (Offen / Disponiert / Einsatz / Beendet). Pure counterpart to the
 *  `toMirrorStatus` used by the stop-list UI, kept here so leaflet overlays can
 *  colour markers without importing the drag-heavy route-stop-list module. */
export function toStopMirrorStatus(op: Operation | undefined): StopMirrorStatus {
  if (!op) return "incoming"
  if (op.status === "complete") return "complete"
  if (op.status === "returning") return "returning"
  if (op.status === "active") return "active"
  if (op.status === "enroute") return "enroute"
  return "incoming"
}

/**
 * Colour class for the age chip: quiet under 60', amber at 60'+, red at
 * 120'+. Colour beats bolding 11px muted text — an incident sitting in a
 * status for two hours must be visible from across the room.
 */
/** How long something has sat, as the three levels the board colours by.
 *  One definition of the thresholds — the age chip and the collapsed-section
 *  alarm dot must never disagree about when an incident is overdue. */
export type AgeLevel = "normal" | "warn" | "alarm"

export function ageLevel(date: Date): AgeLevel {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (minutes >= 120) return "alarm"
  if (minutes >= 60) return "warn"
  return "normal"
}

export function ageChipClass(date: Date): string {
  switch (ageLevel(date)) {
    case "alarm":
      return "text-red-600 dark:text-red-400 font-medium"
    case "warn":
      return "text-amber-600 dark:text-amber-500 font-medium"
    default:
      return "text-muted-foreground"
  }
}

// Helper function to format time since a given date
export function getTimeSince(date: Date): string {
  // Clamp at 0: minor clock/timezone skew can put the timestamp slightly in the
  // future, which otherwise renders as "-1'" right after an incident is created.
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000 / 60))
  if (minutes < 60) return `${minutes}'`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}'`
}

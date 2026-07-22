import { type Operation, type OperationStatus } from "./contexts/operations-context"
import { getIncidentTypeLabel } from "./incident-types"
import { PRIORITY_COLORS, PRIORITY_LABELS } from "./priority"

// Kanban column definitions
// Colors use light mode defaults with dark: variants
export const columns: Array<{
  id: string
  title: string
  status: OperationStatus[]
  color: string
  collapsible?: boolean
}> = [
  { id: "incoming", title: "EINGEGANGEN", status: ["incoming"], color: "bg-slate-200/80 dark:bg-slate-800/70" },
  { id: "ready", title: "REKO", status: ["ready"], color: "bg-emerald-100/80 dark:bg-emerald-950/70" },
  { id: "rekoDone", title: "REKO ABGESCHLOSSEN", status: ["rekoDone"], color: "bg-teal-100/80 dark:bg-teal-950/70" },
  { id: "enroute", title: "DISPONIERT / ANFAHRT", status: ["enroute"], color: "bg-blue-100/80 dark:bg-blue-950/70" },
  { id: "active", title: "EINSATZ", status: ["active"], color: "bg-orange-100/80 dark:bg-orange-950/70" },
  { id: "returning", title: "BEENDET / RÜCKFAHRT", status: ["returning"], color: "bg-sky-100/80 dark:bg-sky-950/70" },
  { id: "complete", title: "ABGESCHLOSSEN", status: ["complete"], color: "bg-gray-200/80 dark:bg-zinc-900/70", collapsible: true },
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
export type StopMirrorStatus = "incoming" | "enroute" | "active" | "returning"

export function stopStatusBorderClass(status: StopMirrorStatus): string {
  switch (status) {
    case "enroute":
      return "border-l-blue-500/70"
    case "active":
      return "border-l-amber-500/70"
    case "returning":
      return "border-l-emerald-500/70"
    default:
      return "border-l-muted-foreground/40"
  }
}

/**
 * Colour class for the age chip: quiet under 60', amber at 60'+, red at
 * 120'+. Colour beats bolding 11px muted text — an incident sitting in a
 * status for two hours must be visible from across the room.
 */
export function ageChipClass(date: Date): string {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (minutes >= 120) return "text-red-600 dark:text-red-400 font-medium"
  if (minutes >= 60) return "text-amber-600 dark:text-amber-500 font-medium"
  return "text-muted-foreground"
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

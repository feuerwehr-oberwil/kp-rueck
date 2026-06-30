import { type Operation, type OperationStatus } from "./contexts/operations-context"
import { getIncidentTypeLabel } from "./incident-types"

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
export type ColorByDimension = "priority" | "reko" | "vehicle" | "type"

export interface ColorGroup {
  key: string
  label: string
  color: string
}

// German labels for the "Färben nach" dimensions.
export const COLOR_BY_LABELS: Record<ColorByDimension, string> = {
  priority: "Priorität",
  reko: "Reko-Person",
  vehicle: "Fahrzeug",
  type: "Einsatzart",
}

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
// Priority keeps its semantic colours instead of a hashed hue.
const PRIORITY_ACCENTS: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#3b82f6" }
const PRIORITY_LABELS: Record<string, string> = { high: "Hoch", medium: "Mittel", low: "Tief" }

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function colorAccent(key: string, dimension: ColorByDimension): string {
  if (dimension === "priority") return PRIORITY_ACCENTS[key] ?? "#64748b"
  return ACCENT_PALETTE[hashString(key) % ACCENT_PALETTE.length]
}

/** The colour group an operation belongs to for the chosen dimension, or null
 *  when it has no value there (e.g. no Reko assigned). */
export function colorGroupFor(operation: Operation, dimension: ColorByDimension): ColorGroup | null {
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
      label = PRIORITY_LABELS[key] ?? key
      break
    default:
      return null
  }
  if (!key) return null
  return { key, label: label ?? key, color: colorAccent(key, dimension) }
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

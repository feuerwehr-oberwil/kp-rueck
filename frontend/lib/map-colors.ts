import { PRIORITY_COLORS } from "./priority"
/**
 * Named map-marker colors.
 *
 * Leaflet builds markers by injecting SVG strings into a `divIcon`, which
 * means the colors live inside template-literal strings — CSS custom
 * properties don't resolve in that context. Rather than scatter raw hex
 * values across half a dozen files, we keep them here and reference by
 * name. The values mirror the semantic tokens in app/globals.css
 * (`--destructive`, `--warning`, `--success`, `--info`); if those tokens
 * ever change, change these too.
 */

export const MAP_COLORS = {
  /** Same hue as `--destructive`. */
  destructive: "#ef4444",
  /** Same hue as `--warning`. */
  warning: "#eab308",
  /** Same hue as `--success`. */
  success: "#22c55e",
  /** Same hue as `--info`. Used for selected/highlighted markers + GPS-online dots. */
  info: "#3b82f6",
  /** Tailwind gray-500 — used as the "offline / no signal" marker fill. */
  offline: "#6b7280",
} as const

/**
 * Map from incident priority → marker fill color. Mirrors the priority
 * styling we use across the kanban/display board (high=red, medium=yellow,
 * low=green).
 */
export const PRIORITY_MARKER_COLORS: Record<"high" | "medium" | "low", string> = PRIORITY_COLORS

import { type OperationStatus } from "./contexts/operations-context"

// Kanban column definitions
// Colors use light mode defaults with dark: variants
export const columns: Array<{
  id: string
  title: string
  status: OperationStatus[]
  color: string
}> = [
  { id: "incoming", title: "EINGEGANGEN", status: ["incoming"], color: "bg-slate-200/80 dark:bg-zinc-800/50" },
  { id: "ready", title: "REKO", status: ["ready"], color: "bg-emerald-100/80 dark:bg-zinc-800/50" },
  { id: "enroute", title: "DISPONIERT / UNTERWEGS", status: ["enroute"], color: "bg-blue-100/80 dark:bg-blue-900/30" },
  { id: "active", title: "EINSATZ", status: ["active"], color: "bg-orange-100/80 dark:bg-orange-900/30" },
  { id: "returning", title: "BEENDET / RÜCKFAHRT", status: ["returning"], color: "bg-sky-100/80 dark:bg-blue-800/30" },
  { id: "complete", title: "ABGESCHLOSSEN", status: ["complete"], color: "bg-gray-200/80 dark:bg-zinc-900/50" },
]

// Helper function to format time since a given date
export function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes}'`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}'`
}

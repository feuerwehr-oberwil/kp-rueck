"use client"

import type { ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * One foldable section of a viewer column (a board status, a Funktion, a
 * Materialkategorie).
 *
 * The header is the same row it always was plus a chevron — and it keeps its
 * count and its state badge WHEN COLLAPSED. That is the whole point: folding
 * hides rows, and a header that shrank to a bare title would hide the fact that
 * three of those rows are overdue. Whoever walks up to the screen has to be able
 * to read that off the closed section.
 */
export function CollapsibleSection({
  label,
  count,
  badge,
  alarm = false,
  collapsed,
  onToggle,
  headerClassName,
  children,
}: {
  label: string
  /** How many rows are in there — shown open and closed alike. */
  count: number
  /** Optional second figure, e.g. «4/9 verfügbar». */
  badge?: ReactNode
  /** Something in here needs attention; stays visible while collapsed. */
  alarm?: boolean
  collapsed: boolean
  onToggle: () => void
  headerClassName?: string
  children: ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={cn(
          "flex w-full items-center gap-2 border-b border-border px-3 xl:px-4 py-1.5 xl:py-2 text-left transition-colors hover:bg-foreground/5",
          headerClassName,
        )}
      >
        {collapsed
          ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate text-[10px] xl:text-xs font-bold uppercase tracking-wider text-foreground/70">
          {label}
        </span>
        {alarm && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
        )}
        {badge}
        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-foreground/10 px-1 text-[10px] xl:text-xs font-bold tabular-nums text-foreground">
          {count}
        </span>
      </button>
      {!collapsed && children}
    </div>
  )
}

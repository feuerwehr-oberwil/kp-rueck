"use client"

/**
 * The shell both resource sidebars build their «Filter & Sortierung» from (owner pick 4A,
 * 23.11.2026; the material one 24.11.): one button beside the search, with the number of
 * chosen filters, opening a popover of sections – Sortierung first, the filters below – and
 * the one-line summary under the search, whose ✕ resets everything.
 *
 *   <SidebarFilterPopover count={2} changed onReset={reset} side="right" footer="12 von 26 Personen" buttonRef={ref}>
 *     <FilterChoiceRow label="Sortierung" options={sorts} value={prefs.sort} onChange={…} />
 *     <FilterSection label="Grad" hint="einer davon">{chips}</FilterSection>
 *   </SidebarFilterPopover>
 *   <SidebarFilterSummary parts={['Wm, Kpl', 'nach Grad']} onReset={reset} buttonRef={ref} />
 *
 * Presentational: each sidebar's facets and rule live in its own view module
 * (`lib/personnel-view.ts`, `lib/material-view.ts`), the stored prefs on the board page.
 * Keyboard: Tab from the search reaches the button, Enter opens, Tab walks the choices, Escape
 * closes (Radix Popover). Both resets unmount themselves, so they hand focus on: the popover's
 * to its first choice, the summary's to the button (pass the same `buttonRef` to both).
 */

import { useRef, type MouseEvent, type ReactNode, type Ref, type RefObject } from "react"
import { useTranslations } from "next-intl"
import { Check, ListFilter, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip"
import { cn } from "@/lib/utils"

/** `list` with `value` added, or taken out when it was there – a multi-select chip's click. */
export const toggled = (list: readonly string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

/** One option: outline, or the tonal «selected» with a ✓ (never colour alone). */
export function FilterChoice({
  on,
  onClick,
  count,
  title,
  className,
  children,
}: {
  on: boolean
  onClick: () => void
  count?: number
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={on ? "selected" : "outline"}
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={cn("gap-1 px-2", className)}
    >
      {on && <Check className="size-3" aria-hidden="true" />}
      {children}
      {count !== undefined && (
        <span className={cn("tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>{count}</span>
      )}
    </Button>
  )
}

/** A labelled group of choices; `hint` says how they combine («einer davon»). */
export function FilterSection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-label text-muted-foreground">{label}</span>
        {hint && <span className="type-micro text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export interface FilterOption<V extends string> {
  value: V
  label: string
  count?: number
}

/** A single-select section (Sortierung, Status): equal-width choices, wrapping when they
 *  do not fit one line. */
export function FilterChoiceRow<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly FilterOption<V>[]
  value: V
  onChange: (value: V) => void
}) {
  return (
    <FilterSection label={label}>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <FilterChoice
            key={option.value}
            on={value === option.value}
            onClick={() => onChange(option.value)}
            count={option.count}
            className="flex-1"
          >
            {option.label}
          </FilterChoice>
        ))}
      </div>
    </FilterSection>
  )
}

export function SidebarFilterPopover({
  count,
  changed,
  onReset,
  side,
  footer,
  buttonRef,
  children,
}: {
  /** Chosen filter values, on the button; the sort is not a filter. */
  count: number
  /** Anything differs from the sidebar's default view, sort included. */
  changed: boolean
  onReset: () => void
  /** Away from the sidebar, over the board: `right` for the left sidebar. */
  side: "left" | "right"
  /** «12 von 26 Personen» under the sections. */
  footer: string
  buttonRef?: Ref<HTMLButtonElement>
  children: ReactNode
}) {
  const t = useTranslations("kanban.dashboard.sidebarFilter")
  const label = count > 0 ? t("buttonActive", { count }) : t("title")
  const bodyRef = useRef<HTMLDivElement>(null)
  const reset = () => {
    onReset()
    bodyRef.current?.querySelector("button")?.focus()
  }

  return (
    <Popover>
      <ShortcutTooltip label={label}>
        <PopoverTrigger asChild>
          <Button
            ref={buttonRef}
            size="icon-xs"
            variant={changed ? "selected" : "ghost"}
            aria-label={label}
            className={cn(
              "flex-shrink-0 gap-1 border px-1.5",
              !changed && "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <ListFilter className="size-4" />
            {count > 0 && <span className="type-caption tabular-nums">{count}</span>}
          </Button>
        </PopoverTrigger>
      </ShortcutTooltip>
      {/* Keys typed in here stay here: the board's shortcuts listen on window, and ↓ would move
          the board selection instead of scrolling the popover. Escape too – Radix closes the
          popover from its own document listener (capture phase, before this one), and the
          board must not also take it, e.g. to cancel an armed «G» chord. */}
      <PopoverContent
        align="start"
        side={side}
        className="w-80 space-y-3 p-3.5"
        onKeyDown={(event) => event.stopPropagation()}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          {changed && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted-foreground underline underline-offset-2 decoration-muted-foreground/50 transition-colors hover:text-foreground hover:decoration-foreground"
            >
              {t("reset")}
            </button>
          )}
        </div>
        <div ref={bodyRef} className="space-y-3">
          {children}
        </div>
        <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">{footer}</p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The chosen filters in one line under the search – «Wm, Kpl · F · nach Grad» – so a narrowed
 * list never passes for the whole one. Nothing when no part is left (the default view).
 */
export function SidebarFilterSummary({
  parts,
  onReset,
  buttonRef,
}: {
  /** One entry per chosen facet and a non-default sort; empty ones are dropped. */
  parts: readonly (string | null)[]
  onReset: () => void
  /** The filter button, which takes focus after a keyboard reset. */
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations("kanban.dashboard.sidebarFilter")
  const summary = parts.filter(Boolean).join(" · ")
  if (!summary) return null

  // Enter/Space fire a click with `detail` 0. Only then move focus: after a mouse click it would
  // pop the button's tooltip.
  const reset = (event: MouseEvent) => {
    onReset()
    if (event.detail === 0) buttonRef?.current?.focus()
  }

  return (
    <div className="flex items-center gap-1.5 pb-1.5 pl-4 pr-3">
      <span className="min-w-0 flex-1 truncate type-micro text-sel-foreground" title={summary}>
        {summary}
      </span>
      <ShortcutTooltip label={t("resetAll")}>
        <button
          type="button"
          onClick={reset}
          aria-label={t("resetAll")}
          className="relative hit-area inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      </ShortcutTooltip>
    </div>
  )
}

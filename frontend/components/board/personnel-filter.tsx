"use client"

/**
 * The Personen-Leiste's «Filter & Sortierung» (owner pick 4A, 23.11.2026): one button beside
 * the search, with the number of chosen filters, opening a popover of Status, Grad, Tags and
 * Sortierung; and the one-line summary under the search, whose ✕ resets everything.
 *
 *   <PersonnelFilterButton prefs={prefs} onChange={setPrefs} facets={facets} shown={12} total={26} />
 *   <PersonnelFilterSummary prefs={prefs} onReset={() => setPrefs(DEFAULT_PERSONNEL_VIEW)} />
 *
 * Presentational: the rule is `lib/personnel-view.ts`, the stored prefs the board page's.
 * Keyboard: Tab from the search reaches the button, Enter opens, Tab walks the choices, Escape
 * closes (Radix Popover). Both resets unmount themselves, so they hand focus on: the popover's
 * to «Alle», the summary's to the button (pass the same `buttonRef` to both).
 */

import { useRef, type MouseEvent, type ReactNode, type Ref, type RefObject } from "react"
import { useTranslations } from "next-intl"
import { Check, ListFilter, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ShortcutTooltip } from "@/components/ui/shortcut-tooltip"
import {
  activeFilterCount,
  DEFAULT_PERSONNEL_VIEW,
  isDefaultView,
  type personnelFacets,
  type PersonnelSort,
  type PersonnelStatus,
  type PersonnelViewPrefs,
} from "@/lib/personnel-view"
import { abbreviateRank } from "@/lib/roster-order"
import { cn } from "@/lib/utils"

type Facets = ReturnType<typeof personnelFacets>

const toggled = (list: readonly string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

/** One option: outline, or the tonal «selected» with a ✓ (never colour alone). */
function Choice({
  on,
  onClick,
  count,
  title,
  className,
  ref,
  children,
}: {
  ref?: Ref<HTMLButtonElement>
  on: boolean
  onClick: () => void
  count?: number
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Button
      ref={ref}
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

function Section({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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

/** The grade as the rows write it («Wm»), or «Ohne Grad». */
function useGradeLabel() {
  const t = useTranslations("kanban.dashboard.personnelFilter")
  return (key: string) => (key ? abbreviateRank(key) : t("noGrade"))
}

export function PersonnelFilterButton({
  prefs,
  onChange,
  facets,
  shown,
  total,
  buttonRef,
}: {
  prefs: PersonnelViewPrefs
  onChange: (prefs: PersonnelViewPrefs) => void
  facets: Facets
  shown: number
  total: number
  buttonRef?: Ref<HTMLButtonElement>
}) {
  const t = useTranslations("kanban.dashboard.personnelFilter")
  const gradeLabel = useGradeLabel()
  const count = activeFilterCount(prefs)
  const changed = !isDefaultView(prefs)
  const label = count > 0 ? t("buttonActive", { count }) : t("title")
  const set = (patch: Partial<PersonnelViewPrefs>) => onChange({ ...prefs, ...patch })
  const allRef = useRef<HTMLButtonElement>(null)
  const reset = () => {
    onChange(DEFAULT_PERSONNEL_VIEW)
    allRef.current?.focus()
  }

  const statuses: { value: PersonnelStatus; label: string }[] = [
    { value: "all", label: t("statusAll") },
    { value: "free", label: t("statusFree") },
    { value: "bound", label: t("statusBound") },
  ]
  const sorts: { value: PersonnelSort; label: string }[] = [
    { value: "rank", label: t("sortRank") },
    { value: "name", label: t("sortName") },
    { value: "free-first", label: t("sortFreeFirst") },
  ]

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
      <PopoverContent align="start" side="right" className="w-80 space-y-3 p-3.5">
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

        <Section label={t("status")}>
          <div className="flex gap-1">
            {statuses.map(({ value, label: text }) => (
              <Choice
                key={value}
                ref={value === "all" ? allRef : undefined}
                on={prefs.status === value}
                onClick={() => set({ status: value })}
                count={value === "all" ? undefined : facets.status[value]}
                className="flex-1"
              >
                {text}
              </Choice>
            ))}
          </div>
        </Section>

        {facets.grades.length > 0 && (
          <Section label={t("grade")} hint={t("gradeHint")}>
            <div className="flex flex-wrap gap-1">
              {facets.grades.map(({ key, count: n }) => (
                <Choice
                  key={key}
                  on={prefs.grades.includes(key)}
                  onClick={() => set({ grades: toggled(prefs.grades, key) })}
                  count={n}
                  title={key || undefined}
                >
                  {gradeLabel(key)}
                </Choice>
              ))}
            </div>
          </Section>
        )}

        {facets.tags.length > 0 && (
          <Section label={t("tags")} hint={t("tagsHint")}>
            <div className="flex flex-wrap gap-1">
              {facets.tags.map(({ tag, count: n }) => (
                <Choice
                  key={tag}
                  on={prefs.tags.includes(tag)}
                  onClick={() => set({ tags: toggled(prefs.tags, tag) })}
                  count={n}
                  className="max-w-full whitespace-normal"
                >
                  <span className="min-w-0 break-words text-left">{tag}</span>
                </Choice>
              ))}
            </div>
          </Section>
        )}

        <Section label={t("sort")}>
          <div className="flex gap-1">
            {sorts.map(({ value, label: text }) => (
              <Choice key={value} on={prefs.sort === value} onClick={() => set({ sort: value })} className="flex-1">
                {text}
              </Choice>
            ))}
          </div>
        </Section>

        <p className="border-t border-border pt-2.5 text-xs text-muted-foreground">
          {t("shown", { shown, total })}
        </p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The chosen filters in one line under the search – «Wm, Kpl · F · nach Grad» – so a narrowed
 * list never passes for the whole roster. Nothing while the view is today's default.
 */
export function PersonnelFilterSummary({
  prefs,
  onReset,
  buttonRef,
}: {
  prefs: PersonnelViewPrefs
  onReset: () => void
  /** The filter button, which takes focus after a keyboard reset. */
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations("kanban.dashboard.personnelFilter")
  const gradeLabel = useGradeLabel()
  if (isDefaultView(prefs)) return null

  const parts = [
    prefs.status === "free" ? t("statusFree") : prefs.status === "bound" ? t("statusBound") : null,
    prefs.grades.map(gradeLabel).join(", "),
    prefs.tags.join(", "),
    prefs.sort === "rank" ? t("summaryRank") : prefs.sort === "name" ? t("summaryName") : null,
  ].filter(Boolean)
  const summary = parts.join(" · ")
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

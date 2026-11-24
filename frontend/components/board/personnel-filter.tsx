"use client"

/**
 * The Personen-Leiste's «Filter & Sortierung» (owner pick 4A, 23.11.2026): Sortierung first –
 * the one most often changed (owner, 24.11.) – then Status, Grad and Tags, in the shared shell
 * (`sidebar-filter.tsx`); and the one-line summary under the search, whose ✕ resets everything.
 *
 *   <PersonnelFilterButton prefs={prefs} onChange={setPrefs} facets={facets} shown={12} total={26} />
 *   <PersonnelFilterSummary prefs={prefs} onReset={() => setPrefs(DEFAULT_PERSONNEL_VIEW)} />
 *
 * Presentational: the rule is `lib/personnel-view.ts`, the stored prefs the board page's.
 */

import type { RefObject } from "react"
import { useTranslations } from "next-intl"
import {
  FilterChoice,
  FilterChoiceRow,
  FilterSection,
  SidebarFilterPopover,
  SidebarFilterSummary,
  toggled,
} from "@/components/board/sidebar-filter"
import {
  activeFilterCount,
  DEFAULT_PERSONNEL_VIEW,
  isDefaultView,
  type personnelFacets,
  type PersonnelViewPrefs,
} from "@/lib/personnel-view"
import { abbreviateRank } from "@/lib/roster-order"

type Facets = ReturnType<typeof personnelFacets>

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
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations("kanban.dashboard.personnelFilter")
  const tShared = useTranslations("kanban.dashboard.sidebarFilter")
  const gradeLabel = useGradeLabel()
  const set = (patch: Partial<PersonnelViewPrefs>) => onChange({ ...prefs, ...patch })

  return (
    <SidebarFilterPopover
      count={activeFilterCount(prefs)}
      changed={!isDefaultView(prefs)}
      onReset={() => onChange(DEFAULT_PERSONNEL_VIEW)}
      side="right"
      footer={t("shown", { shown, total })}
      buttonRef={buttonRef}
    >
      <FilterChoiceRow
        label={tShared("sort")}
        value={prefs.sort}
        onChange={(sort) => set({ sort })}
        options={[
          { value: "rank", label: t("sortRank") },
          { value: "name", label: t("sortName") },
          { value: "free-first", label: t("sortFreeFirst") },
        ]}
      />

      <FilterChoiceRow
        label={tShared("status")}
        value={prefs.status}
        onChange={(status) => set({ status })}
        options={[
          { value: "all", label: tShared("statusAll") },
          { value: "free", label: tShared("statusFree"), count: facets.status.free },
          { value: "bound", label: tShared("statusBound"), count: facets.status.bound },
        ]}
      />

      {facets.grades.length > 0 && (
        <FilterSection label={t("grade")} hint={t("gradeHint")}>
          <div className="flex flex-wrap gap-1">
            {facets.grades.map(({ key, count: n }) => (
              <FilterChoice
                key={key}
                on={prefs.grades.includes(key)}
                onClick={() => set({ grades: toggled(prefs.grades, key) })}
                count={n}
                title={key || undefined}
              >
                {gradeLabel(key)}
              </FilterChoice>
            ))}
          </div>
        </FilterSection>
      )}

      {facets.tags.length > 0 && (
        <FilterSection label={t("tags")} hint={t("tagsHint")}>
          <div className="flex flex-wrap gap-1">
            {facets.tags.map(({ tag, count: n }) => (
              <FilterChoice
                key={tag}
                on={prefs.tags.includes(tag)}
                onClick={() => set({ tags: toggled(prefs.tags, tag) })}
                count={n}
                className="max-w-full whitespace-normal"
              >
                <span className="min-w-0 break-words text-left">{tag}</span>
              </FilterChoice>
            ))}
          </div>
        </FilterSection>
      )}
    </SidebarFilterPopover>
  )
}

/** «Wm, Kpl · F · nach Grad» under the search; nothing while the view is today's default. */
export function PersonnelFilterSummary({
  prefs,
  onReset,
  buttonRef,
}: {
  prefs: PersonnelViewPrefs
  onReset: () => void
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations("kanban.dashboard.personnelFilter")
  const tShared = useTranslations("kanban.dashboard.sidebarFilter")
  const gradeLabel = useGradeLabel()
  return (
    <SidebarFilterSummary
      parts={[
        prefs.status === "free" ? tShared("statusFree") : prefs.status === "bound" ? tShared("statusBound") : null,
        prefs.grades.map(gradeLabel).join(", "),
        prefs.tags.join(", "),
        prefs.sort === "rank" ? t("summaryRank") : prefs.sort === "name" ? t("summaryName") : null,
      ]}
      onReset={onReset}
      buttonRef={buttonRef}
    />
  )
}

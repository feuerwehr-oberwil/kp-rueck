"use client"

/**
 * The Material-Leiste's «Filter & Sortierung» (owner note on #370, 24.11.2026): the Personen-
 * Leiste's popover for devices, in the same shell (`sidebar-filter.tsx`) – Sortierung (Standort
 * or Typ) first, then Status, Standort and Typ; and the summary line under the search.
 *
 *   <MaterialFilterButton prefs={prefs} onChange={setPrefs} facets={facets} shown={40} total={112} />
 *   <MaterialFilterSummary prefs={prefs} onReset={() => setPrefs(DEFAULT_MATERIAL_VIEW)} />
 *
 * Presentational: the rule is `lib/material-view.ts`, the stored prefs the board page's.
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
  DEFAULT_MATERIAL_VIEW,
  isDefaultMaterialView,
  materialFilterCount,
  type MaterialFacet,
  type materialFacets,
  type MaterialStatus,
  type MaterialViewPrefs,
} from "@/lib/material-view"

type Facets = ReturnType<typeof materialFacets>

/** A depot or a Typ as the list heads it; the empty value gets its word. */
export function useMaterialLabels() {
  const t = useTranslations("kanban.dashboard.materialFilter")
  return {
    location: (key: string) => key || t("noLocation"),
    type: (key: string) => key || t("noType"),
  }
}

/** Multi-select chips for Standort or Typ; long depot names wrap instead of widening. */
function FacetChips({
  facets,
  chosen,
  label,
  onToggle,
}: {
  facets: readonly MaterialFacet[]
  chosen: readonly string[]
  label: (key: string) => string
  onToggle: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {facets.map(({ key, count }) => (
        <FilterChoice
          key={key}
          on={chosen.includes(key)}
          onClick={() => onToggle(key)}
          count={count}
          className="max-w-full whitespace-normal"
        >
          <span className="min-w-0 break-words text-left">{label(key)}</span>
        </FilterChoice>
      ))}
    </div>
  )
}

export function MaterialFilterButton({
  prefs,
  onChange,
  facets,
  shown,
  total,
  buttonRef,
}: {
  prefs: MaterialViewPrefs
  onChange: (prefs: MaterialViewPrefs) => void
  facets: Facets
  shown: number
  total: number
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations("kanban.dashboard.materialFilter")
  const tShared = useTranslations("kanban.dashboard.sidebarFilter")
  const labels = useMaterialLabels()
  const set = (patch: Partial<MaterialViewPrefs>) => onChange({ ...prefs, ...patch })
  const statusOption = (value: MaterialStatus, label: string) => ({
    value,
    label,
    count: value === "all" ? undefined : facets.status[value],
  })

  return (
    <SidebarFilterPopover
      count={materialFilterCount(prefs)}
      changed={!isDefaultMaterialView(prefs)}
      onReset={() => onChange(DEFAULT_MATERIAL_VIEW)}
      side="left"
      footer={t("shown", { shown, total })}
      buttonRef={buttonRef}
    >
      <FilterChoiceRow
        label={tShared("sort")}
        value={prefs.sort}
        onChange={(sort) => set({ sort })}
        options={[
          { value: "location", label: t("sortLocation") },
          { value: "type", label: t("sortType") },
        ]}
      />

      <FilterChoiceRow
        label={tShared("status")}
        value={prefs.status}
        onChange={(status) => set({ status })}
        options={[
          statusOption("all", tShared("statusAll")),
          statusOption("free", tShared("statusFree")),
          statusOption("bound", tShared("statusBound")),
          statusOption("not-ready", t("statusNotReady")),
        ]}
      />

      {facets.locations.length > 0 && (
        <FilterSection label={t("location")} hint={t("oneOfHint")}>
          <FacetChips
            facets={facets.locations}
            chosen={prefs.locations}
            label={labels.location}
            onToggle={(key) => set({ locations: toggled(prefs.locations, key) })}
          />
        </FilterSection>
      )}

      {facets.types.length > 0 && (
        <FilterSection label={t("type")} hint={t("oneOfHint")}>
          <FacetChips
            facets={facets.types}
            chosen={prefs.types}
            label={labels.type}
            onToggle={(key) => set({ types: toggled(prefs.types, key) })}
          />
        </FilterSection>
      )}
    </SidebarFilterPopover>
  )
}

/** «Frei · TLF · Tauchpumpen · nach Typ» under the search; nothing while the view is today's. */
export function MaterialFilterSummary({
  prefs,
  onReset,
  buttonRef,
}: {
  prefs: MaterialViewPrefs
  onReset: () => void
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const t = useTranslations("kanban.dashboard.materialFilter")
  const tShared = useTranslations("kanban.dashboard.sidebarFilter")
  const labels = useMaterialLabels()
  const status = {
    all: null,
    free: tShared("statusFree"),
    bound: tShared("statusBound"),
    "not-ready": t("statusNotReady"),
  } satisfies Record<MaterialStatus, string | null>
  return (
    <SidebarFilterSummary
      parts={[
        status[prefs.status],
        prefs.locations.map(labels.location).join(", "),
        prefs.types.map(labels.type).join(", "),
        prefs.sort === "type" ? t("summaryType") : null,
      ]}
      onReset={onReset}
      buttonRef={buttonRef}
    />
  )
}

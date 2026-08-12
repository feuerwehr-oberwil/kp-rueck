'use client'

/**
 * The material checklist (plan 25, decision 14).
 *
 * One row per material unit the board has (or had) on this Schadenplatz, with
 * two ticks: **gebraucht** and **vor Ort verblieben**. It replaces both the
 * read-only "Geräte" chips of the first draft and the paper's free-text
 * "Material vor Ort verblieben" line, and it is the single largest piece of
 * manual KP work this plan removes — today somebody works out by hand which of
 * fourteen units are still out.
 *
 * Two rules that are not cosmetic:
 *
 * * **Consumables render `gebraucht` only** (decision 26). A consumable that was
 *   used is gone: it cannot be "left on site" in any sense the board should
 *   track, and it must never reach "Material zurück – freigeben".
 * * **`gebraucht` is a plain yes/no, prefilled ja** (§18.32). It used to be a
 *   three-state ✓ / ✗ / – control, and on a phone in the rain three 36px
 *   targets in a row is one target too many. The unit was dispatched to this
 *   Schadenplatz, so "gebraucht" is the board's own answer and the crew unticks
 *   the exceptions — exactly the shape the vehicle list next to it has.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle, ChevronDown, ChevronUp, Circle, PackageOpen, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchInput } from '@/components/ui/search-input'
import { cn } from '@/lib/utils'
import type { ApiRapportExtraMaterial, ApiRapportMaterialRow } from '@/lib/api/types'
import {
  groupMaterialsByLocation,
  setExtraMaterialFreeText,
  setExtraMaterialLeftOnSite,
  splitExtraMaterial,
  toggleExtraMaterial,
} from '@/lib/rapport-draft'

interface FeldMaterialChecklistProps {
  rows: ApiRapportMaterialRow[]
  extraMaterials: ApiRapportExtraMaterial[]
  /**
   * Known material names from the catalogue. Offered as a multi-select under
   * "Weiteres Material" so the crew does not have to spell "Tauchpumpe TP-4"
   * from memory — names only, never a unit (see below).
   */
  suggestions?: string[]
  disabled?: boolean
  /** The folded /feld section already carries the title in its own header. */
  hideHeading?: boolean
  onChange: (rows: ApiRapportMaterialRow[]) => void
  onExtraMaterialsChange: (entries: ApiRapportExtraMaterial[]) => void
}

/** How many catalogue entries it takes before a search field earns its place. */
const SEARCH_THRESHOLD = 8

/**
 * "Weiteres gebrauchtes Material" — a multi-select, a free-text line, and one
 * on-site tick per entry (§18.35).
 *
 * The shape is the one the app already uses for picking people
 * (`resource-assignment-dialog`): a search field and a grid of tick rows with
 * the CheckCircle / Circle pair. What is picked appears above as a **row per
 * entry** rather than as a chip, because each entry now carries its own answer
 * to the only question worth asking about it.
 *
 * **There is no `gebraucht` tick here and there must not be one.** Naming a
 * thing on this list already says it was used; a second tick would only ever be
 * ticked. What nothing else in the system knows is whether the borrowed pump is
 * still standing in the cellar — so that is the tick, per entry, because one
 * borrowed thing stays while the other goes home with the crew.
 *
 * **Decision 18's boundary is untouched, and it is the whole point.** This
 * writes NAMES: no id travels with a pick, nothing here is resolved to a unit,
 * and `/feld` still never creates an assignment — a different authorization and
 * conflict problem than anything else in this plan. The consequence is visible
 * rather than hidden: an entry marked *vor Ort verblieben* reaches the Restliste
 * and the Abholliste, and it deliberately does NOT reach "Material zurück –
 * freigeben", which frees assignments. The hint under the list says so.
 *
 * The free-text line stays for exactly the case the catalogue cannot answer: a
 * crew that borrowed the neighbouring brigade's pump has to be able to write it.
 */
function ExtraMaterialPicker({
  entries,
  suggestions,
  disabled,
  onChange,
}: {
  entries: ApiRapportExtraMaterial[]
  suggestions: string[]
  disabled?: boolean
  onChange: (next: ApiRapportExtraMaterial[]) => void
}) {
  const t = useTranslations('feld.rapport.material')
  const [search, setSearch] = useState('')

  // The stored list is the single source of truth: all three controls are
  // derived from it on every render, so a draft written on another phone comes
  // back apart into the same three controls.
  const { picked, freeText } = useMemo(() => splitExtraMaterial(entries, suggestions), [entries, suggestions])
  const pickedNames = useMemo(() => new Set(picked.map(entry => entry.name)), [picked])

  const searching = search.trim().length > 0
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return suggestions
    return suggestions.filter(name => name.toLowerCase().includes(needle))
  }, [suggestions, search])

  /**
   * A long catalogue is not rendered unasked — a scroll area INSIDE a scrolling
   * page is the worst of both on a phone. But it used to be *only* reachable by
   * typing, which asks the crew to guess the station's own names before the list
   * will admit they exist. So it collapses behind one tap instead, exactly like
   * «Weitere Angemeldete» in the personnel checklist: the list is there, it is
   * just folded. Search still narrows it, and what is already ticked stays
   * visible either way — that is the answer to "habe ich das erfasst?".
   */
  const [showAll, setShowAll] = useState(false)
  const collapsible = suggestions.length > SEARCH_THRESHOLD
  const listOpen = !collapsible || showAll || searching

  const listed = useMemo(() => {
    if (listOpen) return filtered
    return suggestions.filter(name => pickedNames.has(name))
  }, [listOpen, suggestions, filtered, pickedNames])

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
        <div className="space-y-1.5">
          {entries.map(entry => (
            <div
              key={entry.name}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-secondary/40 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <PackageOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{entry.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {/* The same control and the same wording as the checklist
                    above — one question, asked the same way twice. */}
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={entry.left_on_site}
                    disabled={disabled}
                    aria-label={t('leftOnSiteAria', { name: entry.name })}
                    onChange={e => onChange(setExtraMaterialLeftOnSite(entries, entry.name, e.target.checked))}
                  />
                  {t('leftOnSite')}
                </label>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(toggleExtraMaterial(entries, entry.name))}
                  title={t('extraRemove', { name: entry.name })}
                  aria-label={t('extraRemove', { name: entry.name })}
                  className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {/* The asymmetry, said out loud instead of left to be discovered:
              these are names, not units the board dispatched, so the Abholliste
              fetches them and "Material zurück – freigeben" has nothing to free. */}
          {entries.some(entry => entry.left_on_site) && (
            <p className="text-xs text-muted-foreground">{t('extraLeftOnSiteHint')}</p>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          {collapsible && (
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t('extraSearchPlaceholder')}
              disabled={disabled}
            />
          )}
          {collapsible && !listOpen && (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground"
              onClick={() => setShowAll(true)}
            >
              <ChevronDown className="h-4 w-4 shrink-0" />
              {t('extraShowAll', { count: suggestions.length })}
            </button>
          )}
          {collapsible && showAll && !searching && (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-xs text-muted-foreground"
              onClick={() => setShowAll(false)}
            >
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              {t('extraHideAll')}
            </button>
          )}
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {listed.map(name => {
              const isPicked = pickedNames.has(name)
              return (
                <button
                  key={name}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isPicked}
                  onClick={() => onChange(toggleExtraMaterial(entries, name))}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border/50 px-2.5 py-2 text-left transition-colors',
                    'hover:border-primary/50 hover:bg-secondary/30 disabled:cursor-not-allowed disabled:opacity-50',
                    isPicked && 'border-primary/30 bg-primary/5',
                  )}
                >
                  {isPicked ? (
                    <CheckCircle className="h-5 w-5 shrink-0 text-emerald-500" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-sm">{name}</span>
                </button>
              )
            })}
            {listed.length === 0 && listOpen && (
              <p className="col-span-full py-2 text-xs text-muted-foreground">
                {t('extraNoneFound')}
              </p>
            )}
          </div>
        </>
      )}

      {/* Anything in no catalogue at all. The panel says so, because a list
          that looks exhaustive is a list people stop writing next to. */}
      <div className="space-y-1">
        <Input
          id="rapport-extra-material"
          autoComplete="off"
          value={freeText}
          disabled={disabled}
          placeholder={t('extraPlaceholder')}
          onChange={e => onChange(setExtraMaterialFreeText(entries, e.target.value, suggestions))}
        />
        <p className="text-xs text-muted-foreground">{t('extraFreeText')}</p>
      </div>
    </div>
  )
}

export function FeldMaterialChecklist({
  rows,
  extraMaterials,
  suggestions = [],
  disabled,
  hideHeading,
  onChange,
  onExtraMaterialsChange,
}: FeldMaterialChecklistProps) {
  const t = useTranslations('feld.rapport.material')
  const groups = groupMaterialsByLocation(rows)

  const update = (assignmentId: string, patch: Partial<ApiRapportMaterialRow>) => {
    onChange(rows.map(row => (row.assignment_id === assignmentId ? { ...row, ...patch } : row)))
  }

  return (
    <section className="space-y-3">
      {!hideHeading && <h3 className="text-sm font-semibold">{t('title')}</h3>}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {/* The checklist is only as good as the material assignments (§12).
              An empty list is not a bug, it is a board that never got the
              material — which is what the free-text line below is for. */}
          {t('empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, index) => (
            <div key={`${group.onBoard ? group.location ?? '' : 'off'}-${index}`} className="space-y-1.5">
              {(group.location || !group.onBoard) && (
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.onBoard ? group.location : t('noLongerAssigned')}
                </p>
              )}
              {group.rows.map(row => (
                <div
                  key={row.assignment_id}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg bg-secondary/40 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <PackageOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm">{row.name}</span>
                    {row.consumable && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t('consumable')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* One tick, prefilled ja (§18.32) — the same control and
                        the same wording as "vor Ort verblieben" next to it and
                        as the vehicle list below, rather than a fourth way of
                        answering a yes/no question. */}
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={row.used}
                        disabled={disabled}
                        aria-label={t('usedAria', { name: row.name })}
                        onChange={e => update(row.assignment_id, { used: e.target.checked })}
                      />
                      {t('used')}
                    </label>
                    {/* Consumables have no second tick at all — not a disabled
                        one. A control that can never be used is noise. */}
                    {!row.consumable && (
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={row.left_on_site}
                          disabled={disabled}
                          aria-label={t('leftOnSiteAria', { name: row.name })}
                          onChange={e => update(row.assignment_id, { left_on_site: e.target.checked })}
                        />
                        {t('leftOnSite')}
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="rapport-extra-material" className="text-xs text-muted-foreground">
          {t('extraLabel')}
        </Label>
        {/* Still names in the data model, and it still never creates an
            assignment (decision 18): a picker that resolved to units would make
            /feld a writer of assignments, a different authorization and conflict
            problem than anything else in this plan. The list below names things
            — anything typed stays valid, and nothing here carries an id. */}
        <ExtraMaterialPicker
          entries={extraMaterials}
          suggestions={suggestions}
          disabled={disabled}
          onChange={onExtraMaterialsChange}
        />
      </div>
    </section>
  )
}

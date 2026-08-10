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
import { CheckCircle, Circle, PackageOpen } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RemovableChip } from '@/components/ui/removable-chip'
import { SearchInput } from '@/components/ui/search-input'
import { cn } from '@/lib/utils'
import type { ApiRapportMaterialRow } from '@/lib/api/types'
import {
  formatExtraMaterial,
  groupMaterialsByLocation,
  parseExtraMaterial,
} from '@/lib/rapport-draft'

interface FeldMaterialChecklistProps {
  rows: ApiRapportMaterialRow[]
  extraNote: string
  /**
   * Known material names from the catalogue. Offered as a multi-select under
   * "Weiteres Material" so the crew does not have to spell "Tauchpumpe TP-4"
   * from memory — names only, never a unit (see below).
   */
  suggestions?: string[]
  disabled?: boolean
  onChange: (rows: ApiRapportMaterialRow[]) => void
  onExtraNoteChange: (value: string) => void
}

/** How many catalogue entries it takes before a search field earns its place. */
const SEARCH_THRESHOLD = 8

/**
 * "Weiteres gebrauchtes Material" — a multi-select over the catalogue, plus a
 * free-text line (§18.34).
 *
 * The shape is the one the app already uses for picking people
 * (`resource-assignment-dialog`): a search field, a grid of tick rows with the
 * CheckCircle / Circle pair, and the picked things as chips above. Not a third
 * pattern — the previous combobox was one, and it was invisible on desktop
 * before that as a native `datalist`.
 *
 * **Decision 18's boundary is untouched, and it is the whole point.** This
 * writes a comma-separated string of NAMES: no id travels with a pick, nothing
 * here is resolved to a unit, and `/feld` still never creates an assignment —
 * a different authorization and conflict problem than anything else in this
 * plan. Picking from a list is still just naming a thing.
 *
 * The free-text line stays for exactly the case the catalogue cannot answer: a
 * crew that borrowed the neighbouring brigade's pump has to be able to write it.
 */
function ExtraMaterialPicker({
  value,
  suggestions,
  disabled,
  onChange,
}: {
  value: string
  suggestions: string[]
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const t = useTranslations('feld.rapport.material')
  const [search, setSearch] = useState('')

  // The stored string is the single source of truth: the two controls are
  // derived from it on every render, so a draft written on another phone comes
  // back apart into the same two controls.
  const { picked, freeText } = useMemo(() => parseExtraMaterial(value, suggestions), [value, suggestions])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return suggestions
    return suggestions.filter(name => name.toLowerCase().includes(needle))
  }, [suggestions, search])

  const toggle = (name: string) => {
    const next = picked.includes(name) ? picked.filter(entry => entry !== name) : [...picked, name]
    onChange(formatExtraMaterial(next, freeText))
  }

  return (
    <div className="space-y-2">
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map(name => (
            <RemovableChip
              key={name}
              onRemove={disabled ? undefined : () => toggle(name)}
              removeTitle={t('extraRemove', { name })}
            >
              {name}
            </RemovableChip>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <>
          {suggestions.length > SEARCH_THRESHOLD && (
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t('extraSearchPlaceholder')}
              disabled={disabled}
            />
          )}
          <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {filtered.map(name => {
              const isPicked = picked.includes(name)
              return (
                <button
                  key={name}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isPicked}
                  onClick={() => toggle(name)}
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
            {filtered.length === 0 && (
              <p className="col-span-full py-2 text-xs text-muted-foreground">{t('extraNoneFound')}</p>
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
          onChange={e => onChange(formatExtraMaterial(picked, e.target.value))}
        />
        <p className="text-xs text-muted-foreground">{t('extraFreeText')}</p>
      </div>
    </div>
  )
}

export function FeldMaterialChecklist({
  rows,
  extraNote,
  suggestions = [],
  disabled,
  onChange,
  onExtraNoteChange,
}: FeldMaterialChecklistProps) {
  const t = useTranslations('feld.rapport.material')
  const groups = groupMaterialsByLocation(rows)

  const update = (assignmentId: string, patch: Partial<ApiRapportMaterialRow>) => {
    onChange(rows.map(row => (row.assignment_id === assignmentId ? { ...row, ...patch } : row)))
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('title')}</h3>

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
          value={extraNote}
          suggestions={suggestions}
          disabled={disabled}
          onChange={onExtraNoteChange}
        />
      </div>
    </section>
  )
}

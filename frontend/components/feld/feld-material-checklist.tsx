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

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { PackageOpen, X } from 'lucide-react'

import { FeldAddPicker } from '@/components/feld/feld-add-picker'
import type { ApiRapportExtraMaterial, ApiRapportMaterialRow } from '@/lib/api/types'
import {
  addExtraMaterial,
  groupMaterialsByLocation,
  removeExtraMaterial,
  setExtraMaterialLeftOnSite,
} from '@/lib/rapport-draft'

interface FeldMaterialChecklistProps {
  rows: ApiRapportMaterialRow[]
  extraMaterials: ApiRapportExtraMaterial[]
  /**
   * Known material names from the catalogue. Offered in «Material hinzufügen»
   * so the crew does not have to spell "Tauchpumpe TP-4" from memory — names
   * only, never a unit (see below).
   */
  suggestions?: string[]
  disabled?: boolean
  /** The folded /feld section already carries the title in its own header. */
  hideHeading?: boolean
  onChange: (rows: ApiRapportMaterialRow[]) => void
  onExtraMaterialsChange: (entries: ApiRapportExtraMaterial[]) => void
}

/**
 * "Weiteres gebrauchtes Material" — one row per entry with its on-site tick,
 * and «Material hinzufügen» under them (§18.35, owner pick 2A).
 *
 * The picker offers the catalogue, and a typed name that is in no catalogue —
 * the neighbouring brigade's pump — becomes «‹Name› hinzufügen». Both land as
 * the same `{name, left_on_site}` entry the old multi-select and comma line
 * wrote, so a rapport saved before reads back unchanged.
 *
 * **There is no `gebraucht` tick here and there must not be one.** Naming a
 * thing on this list already says it was used; a second tick would only ever be
 * ticked. What nothing else in the system knows is whether the borrowed pump is
 * still standing in the cellar — so that is the tick, per entry.
 *
 * **Decision 18's boundary is untouched, and it is the whole point.** This
 * writes NAMES: no id travels with a pick, nothing here is resolved to a unit,
 * and `/feld` still never creates an assignment. The consequence is visible
 * rather than hidden: an entry marked *vor Ort verblieben* reaches the Restliste
 * and the Abholliste, and it deliberately does NOT reach "Material zurück –
 * freigeben", which frees assignments. The hint under the list says so.
 */
function ExtraMaterialList({
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

  // Only what is not on the list yet — taking a name back out is the row's ✕.
  const pickable = useMemo(() => {
    const taken = new Set(entries.map(entry => entry.name.trim().toLowerCase()))
    return suggestions
      .filter(name => !taken.has(name.trim().toLowerCase()))
      .map(name => ({ key: name, name }))
  }, [entries, suggestions])
  const takenNames = useMemo(() => entries.map(entry => entry.name), [entries])

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
                    className="h-4 w-4 cursor-pointer accent-sel"
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
                  onClick={() => onChange(removeExtraMaterial(entries, entry.name))}
                  title={t('extraRemove', { name: entry.name })}
                  aria-label={t('extraRemove', { name: entry.name })}
                  className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
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

      {!disabled && (
        <FeldAddPicker
          label={t('add')}
          searchPlaceholder={t('extraSearchPlaceholder')}
          items={pickable}
          freeTextLabel={name => t('addTyped', { name })}
          takenNames={takenNames}
          onAdd={(picked, typed) => onChange(addExtraMaterial(entries, [...picked.map(item => item.name), ...typed]))}
        />
      )}
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
    /* One rhythm across the three rapport sections: bestätigen, was zugeteilt
       war — suchen, was fehlt — tippen, was nirgends steht. Same spacing, same
       order, so the crew learns the shape once. Material's confirm block needs
       no origin label: the Lagerort headings sit in that slot and say more. */
    <section className="space-y-4">
      {!hideHeading && <h3 className="text-sm font-semibold">{t('title')}</h3>}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
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
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
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
                        className="h-4 w-4 cursor-pointer accent-sel"
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
                          className="h-4 w-4 cursor-pointer accent-sel"
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

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('extraLabel')}</p>
        {/* Still names in the data model, and it still never creates an
            assignment (decision 18) — see `ExtraMaterialList`. */}
        <ExtraMaterialList
          entries={extraMaterials}
          suggestions={suggestions}
          disabled={disabled}
          onChange={onExtraMaterialsChange}
        />
      </div>
    </section>
  )
}

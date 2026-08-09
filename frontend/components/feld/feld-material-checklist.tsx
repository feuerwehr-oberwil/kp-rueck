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
 * * **Not answering is a third answer.** `used === null` means the crew did not
 *   say, which every output has to be able to show — so the tick is a
 *   three-state control, not a checkbox that defaults to "nein".
 */

import { useTranslations } from 'next-intl'
import { Check, Minus, PackageOpen, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { ApiRapportMaterialRow } from '@/lib/api/types'
import { groupMaterialsByLocation } from '@/lib/rapport-draft'

interface FeldMaterialChecklistProps {
  rows: ApiRapportMaterialRow[]
  extraNote: string
  disabled?: boolean
  onChange: (rows: ApiRapportMaterialRow[]) => void
  onExtraNoteChange: (value: string) => void
}

/** ja / nein / keine Angabe, in that cycle. `null` is a real answer here. */
function UsedToggle({
  value,
  disabled,
  onChange,
  label,
}: {
  value: boolean | null
  disabled?: boolean
  onChange: (next: boolean | null) => void
  label: string
}) {
  const t = useTranslations('feld.rapport.material')
  const options: Array<{ value: boolean | null; icon: React.ReactNode; title: string }> = [
    { value: true, icon: <Check className="h-3.5 w-3.5" />, title: t('usedYes') },
    { value: false, icon: <X className="h-3.5 w-3.5" />, title: t('usedNo') },
    { value: null, icon: <Minus className="h-3.5 w-3.5" />, title: t('usedUnknown') },
  ]
  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex h-8 w-9 items-center justify-center transition-colors disabled:opacity-50',
            value === option.value
              ? option.value === true
                ? 'bg-success/20 text-success'
                : option.value === false
                  ? 'bg-muted text-foreground'
                  : 'bg-muted text-muted-foreground'
              : 'text-muted-foreground/60 hover:bg-muted/60',
          )}
        >
          {option.icon}
        </button>
      ))}
    </div>
  )
}

export function FeldMaterialChecklist({
  rows,
  extraNote,
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
      <div>
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>

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
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{t('used')}</span>
                      <UsedToggle
                        value={row.used}
                        disabled={disabled}
                        label={t('usedAria', { name: row.name })}
                        onChange={next => update(row.assignment_id, { used: next })}
                      />
                    </div>
                    {/* Consumables have no second tick at all — not a disabled
                        one. A control that can never be used is noise. */}
                    {!row.consumable && (
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
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
        {/* Deliberately free text, not a catalog picker (decision 18): a picker
            would make /feld a writer of assignments, which is a different
            authorization and conflict problem than anything else in this plan. */}
        <Input
          id="rapport-extra-material"
          value={extraNote}
          disabled={disabled}
          placeholder={t('extraPlaceholder')}
          onChange={e => onExtraNoteChange(e.target.value)}
        />
      </div>
    </section>
  )
}

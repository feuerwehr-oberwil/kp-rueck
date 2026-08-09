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

import { useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronsUpDown, Minus, PackageOpen, X } from 'lucide-react'

import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ApiRapportMaterialRow } from '@/lib/api/types'
import { groupMaterialsByLocation } from '@/lib/rapport-draft'

interface FeldMaterialChecklistProps {
  rows: ApiRapportMaterialRow[]
  extraNote: string
  /**
   * Known material names from the catalogue. Offered as a browsable list under
   * "Weiteres Material" so the crew does not have to spell "Tauchpumpe TP-4"
   * from memory — a naming aid, never a picker (see below).
   */
  suggestions?: string[]
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

/**
 * "Weiteres gebrauchtes Material" — free text with a browsable catalogue.
 *
 * It used to be an `<input list=…>`. A native `datalist` only reveals itself
 * once you are already typing, which on desktop means the suggestions are
 * invisible: there is nothing to browse, and the crew is back to spelling
 * "Tauchpumpe TP-4" from memory. So the same suggestions moved into a real
 * combobox — Popover + Command, the primitives the rest of the app already
 * uses — that opens on focus or on the chevron and filters while you type.
 *
 * **The boundary of decision 18 is untouched.** This writes a plain string and
 * nothing else: no id travels with a pick, and `/feld` still never creates an
 * assignment. Anything typed stays valid, including a name that is in no
 * catalogue — the list is a spelling aid, not a picker.
 *
 * The line is a comma-separated list (its own placeholder says so), so the
 * filter runs on the segment after the LAST comma: picking a second unit has
 * to work, which it would not if the whole line were the search term.
 */
function ExtraMaterialInput({
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  /** The item the arrow keys point at. Empty on purpose: with nothing pointed
   *  at, Enter belongs to the free text and must not insert anything. */
  const [highlight, setHighlight] = useState('')

  const cut = value.lastIndexOf(',')
  const prefix = cut === -1 ? '' : value.slice(0, cut + 1)
  const segment = (cut === -1 ? value : value.slice(cut + 1)).trim()

  const filtered = useMemo(() => {
    const needle = segment.toLowerCase()
    if (!needle) return suggestions
    return suggestions.filter(name => name.toLowerCase().includes(needle))
  }, [suggestions, segment])

  const hasList = suggestions.length > 0

  const insert = (name: string) => {
    onChange(prefix ? `${prefix} ${name}` : name)
    setOpen(false)
    setHighlight('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hasList) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (filtered.length === 0) return
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setHighlight(filtered[0])
        return
      }
      const index = filtered.indexOf(highlight)
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % filtered.length
          : index <= 0
            ? filtered.length - 1
            : index - 1
      setHighlight(filtered[next])
      return
    }
    if (event.key === 'Enter' && open && filtered.includes(highlight)) {
      event.preventDefault()
      insert(highlight)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      setHighlight('')
    }
  }

  return (
    <Popover open={open && hasList && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            id="rapport-extra-material"
            autoComplete="off"
            role={hasList ? 'combobox' : undefined}
            aria-expanded={hasList ? open : undefined}
            aria-autocomplete={hasList ? 'list' : undefined}
            aria-controls={hasList ? 'rapport-extra-material-options' : undefined}
            value={value}
            disabled={disabled}
            placeholder={t('extraPlaceholder')}
            className={cn(hasList && 'pr-10')}
            onFocus={() => hasList && setOpen(true)}
            onChange={e => {
              setHighlight('')
              if (hasList) setOpen(true)
              onChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
          />
          {hasList && (
            <button
              type="button"
              disabled={disabled}
              // Tab order skips it: it opens the same list the field opens on
              // focus, so for a keyboard it is a duplicate. It exists for the
              // thumb and for the eye — the affordance the datalist never had.
              tabIndex={-1}
              aria-label={t('extraSuggestOpen')}
              title={t('extraSuggestOpen')}
              onClick={() => {
                setOpen(current => !current)
                inputRef.current?.focus()
              }}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 cursor-pointer"
            >
              <ChevronsUpDown className="h-4 w-4" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        // The field keeps the caret the whole time: an autofocused panel would
        // end the typing that opened it.
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        onInteractOutside={e => {
          // Clicking the field itself is not "outside" in any sense the crew
          // would recognise — without this the list closes on every tap.
          if (inputRef.current?.parentElement?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        {/* `shouldFilter={false}`: the filter runs above, on the last segment
            of the line rather than on the whole line. cmdk is here for the
            list semantics and the highlight, not for its matcher. */}
        {/* The sentinel keeps cmdk from pointing at the first row on its own.
            A highlighted row promises that Enter picks it — and Enter has to
            belong to the free text unless the crew took the arrow keys. */}
        <Command shouldFilter={false} value={highlight || ' '}>
          <CommandList id="rapport-extra-material-options" className="max-h-56">
            <CommandGroup heading={t('extraSuggestHeading')}>
              {filtered.map(name => (
                <CommandItem
                  key={name}
                  value={name}
                  // Keep the caret in the field: a blur here would close the
                  // panel before the click ever lands.
                  onMouseDown={e => e.preventDefault()}
                  onSelect={() => insert(name)}
                  // The highlight is driven by the arrow keys alone, so the
                  // mouse gets its feedback from CSS rather than from cmdk.
                  className="min-h-11 cursor-pointer hover:bg-foreground/10"
                >
                  <PackageOpen className="h-4 w-4" />
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t('extraFreeText')}</p>
        </Command>
      </PopoverContent>
    </Popover>
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
        {/* Still free text in the data model, and it still never creates an
            assignment (decision 18): a real picker would make /feld a writer of
            assignments, a different authorization and conflict problem than
            anything else in this plan. The list below only SUGGESTS a spelling —
            anything typed stays valid, and nothing here carries an id. */}
        <ExtraMaterialInput
          value={extraNote}
          suggestions={suggestions}
          disabled={disabled}
          onChange={onExtraNoteChange}
        />
      </div>
    </section>
  )
}

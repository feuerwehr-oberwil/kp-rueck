'use client'

/**
 * The crew confirmation list (§18.36).
 *
 * The crew used to type a number. A number answers neither of the two questions
 * the KP has the morning after — was somebody there that nobody aufgeboten, and
 * did somebody go home that nobody tracked — and every output that printed it
 * wanted the names anyway. So the head count became the vehicle list's twin: one
 * tick per person, the ones the board put on this Schadenplatz arriving ticked,
 * and the crew corrects it in both directions.
 *
 * **The roll-call, not the roster.** The list is who checked in at the Appell
 * tonight; offering the other forty names would make a crew scroll past people
 * who are at home. Somebody from a neighbouring brigade is on no roster at all
 * and goes in by hand below, with a free-text note — «FW Allschwil», «kam um
 * 21:00», whatever the crew needs to say. Names, never ids: `/feld` writes no
 * attendance row and invents no personnel.
 *
 * Layout follows the vehicles exactly, including the fold: a big Ereignis has
 * thirty people checked in, and what the crew came to confirm is the four the
 * board sent.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, Plus, UserRound, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import type { ApiRapportExtraPersonnel, ApiRapportPersonnelRow } from '@/lib/api/types'

interface FeldPersonnelChecklistProps {
  rows: ApiRapportPersonnelRow[]
  extra: ApiRapportExtraPersonnel[]
  disabled?: boolean
  onChange: (rows: ApiRapportPersonnelRow[]) => void
  onExtraChange: (entries: ApiRapportExtraPersonnel[]) => void
}

/** Above this many names the roll-call stops being scannable on a phone. */
const SEARCH_THRESHOLD = 10

export function FeldPersonnelChecklist({
  rows,
  extra,
  disabled,
  onChange,
  onExtraChange,
}: FeldPersonnelChecklistProps) {
  const t = useTranslations('feld.rapport.personnel')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')

  const toggle = (personnelId: string, present: boolean) => {
    onChange(rows.map(row => (row.personnel_id === personnelId ? { ...row, present } : row)))
  }

  const addExtra = () => {
    const name = newName.trim()
    if (!name) return
    onExtraChange([...extra, { name, note: newNote.trim() }])
    setNewName('')
    setNewNote('')
  }

  const removeExtra = (index: number) => {
    onExtraChange(extra.filter((_, i) => i !== index))
  }

  const needle = search.trim().toLowerCase()

  // What the crew is here to confirm: who was sent, or who it has already said
  // was there. An unticked dispatched person stays in this group — answering
  // "nein, der war nicht dabei" must not make the row jump away as it is given.
  const { expected, rest } = useMemo(() => {
    const expected: ApiRapportPersonnelRow[] = []
    const rest: ApiRapportPersonnelRow[] = []
    for (const row of rows) (row.on_board || row.present ? expected : rest).push(row)
    return { expected, rest }
  }, [rows])

  const matches = (row: ApiRapportPersonnelRow) => !needle || row.name.toLowerCase().includes(needle)
  const visibleExpected = expected.filter(row => row.present || matches(row))
  const visibleRest = rest.filter(matches)
  const collapsible = rows.length > SEARCH_THRESHOLD
  const restOpen = !collapsible || showAll || needle.length > 0 || expected.length === 0

  const count = rows.filter(row => row.present).length + extra.length

  return (
    <div className="space-y-2">
      {/* Derived, not typed — and shown, because it is the number that used to be
          the whole answer and somebody still reads the rapport for it. */}
      <p className="text-xs text-muted-foreground">{t('label', { count })}</p>

      {rows.length === 0 && extra.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <>
          {rows.length > SEARCH_THRESHOLD && (
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t('searchPlaceholder')}
              disabled={disabled}
            />
          )}
          <div className="space-y-1.5">
            {visibleExpected.map(row => (
              <PersonRow key={row.personnel_id} row={row} disabled={disabled} onToggle={toggle} />
            ))}
          </div>

          {rest.length > 0 && (
            <div className="space-y-1.5">
              {!restOpen ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground"
                  onClick={() => setShowAll(true)}
                >
                  <ChevronRight className="h-4 w-4 shrink-0" />
                  {t('showRest', { count: rest.length })}
                </button>
              ) : (
                <>
                  {showAll && !needle && expected.length > 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-xs text-muted-foreground"
                      onClick={() => setShowAll(false)}
                    >
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      {t('hideRest')}
                    </button>
                  )}
                  {visibleRest.map(row => (
                    <PersonRow key={row.personnel_id} row={row} disabled={disabled} onToggle={toggle} />
                  ))}
                  {visibleRest.length === 0 && visibleExpected.length === 0 && (
                    <p className="px-1 py-2 text-sm text-muted-foreground">{t('noMatch')}</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* --- Somebody on no roster of this station ------------------------- */}
      <div className="space-y-1.5 pt-1">
        {extra.map((entry, index) => (
          <div
            key={`${entry.name}-${index}`}
            className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{entry.name}</span>
              {entry.note && <span className="truncate text-xs text-muted-foreground">{entry.note}</span>}
            </span>
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('removeAria', { name: entry.name })}
                onClick={() => removeExtra(index)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}

        {!disabled && (
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('extraNamePlaceholder')}
              maxLength={100}
              className="text-sm"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addExtra()
                }
              }}
            />
            <Input
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder={t('extraNotePlaceholder')}
              maxLength={200}
              className="text-sm"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addExtra()
                }
              }}
            />
            <Button type="button" variant="outline" disabled={!newName.trim()} onClick={addExtra}>
              <Plus className="h-4 w-4" />
              {t('addExtra')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function PersonRow({
  row,
  disabled,
  onToggle,
}: {
  row: ApiRapportPersonnelRow
  disabled?: boolean
  onToggle: (personnelId: string, present: boolean) => void
}) {
  const t = useTranslations('feld.rapport.personnel')
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{row.name}</span>
        {row.on_board && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t('dispatched')}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-primary"
          checked={row.present}
          disabled={disabled}
          aria-label={t('presentAria', { name: row.name })}
          onChange={e => onToggle(row.personnel_id, e.target.checked)}
        />
        {t('present')}
      </span>
    </label>
  )
}

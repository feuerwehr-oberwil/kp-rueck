'use client'

/**
 * The Personal section of the Schadenplatz-Rapport.
 *
 * **Confirm what the board sent, search for everything else.** The list used to
 * be the whole Appell — everybody checked in at the Ereignis — plus whoever the
 * board had here. On a storm night that is half the brigade standing in a
 * rapport about one cellar: being checked in says somebody turned out tonight,
 * not that they stood at this address. So a row now belongs to the people the
 * board aufgeboten **here** (released assignments and an Auftrag's crew
 * included), arriving ticked, and the crew corrects that in both directions.
 *
 * Nobody becomes unreachable, which matters because this ends on a sheet that
 * feeds paid hours: everybody else on the roster is one search or one fold away,
 * the Appell sorted first and marked, and adding them writes a real
 * `personnel_id` rather than a free-text name.
 *
 * Same three-step grammar as the Fahrzeuge and Material sections beside it:
 * **bestätigen, was zugeteilt war – suchen, was fehlt – tippen, was nirgends
 * steht.** Only the last step is personnel-specific: somebody from a
 * neighbouring brigade is on no roster at all and goes in by hand with a note.
 *
 * Names, never new records: `/feld` writes no attendance row, invents no
 * personnel and creates no assignment.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Plus, UserRound, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import type {
  ApiRapportExtraPersonnel,
  ApiRapportPersonnelCandidate,
  ApiRapportPersonnelRow,
} from '@/lib/api/types'

interface FeldPersonnelChecklistProps {
  rows: ApiRapportPersonnelRow[]
  extra: ApiRapportExtraPersonnel[]
  /**
   * Everybody the board did NOT send here — the Appell first, the rest of the
   * roster behind it. The server leaves out anyone who already has a row.
   */
  candidates?: ApiRapportPersonnelCandidate[]
  disabled?: boolean
  onChange: (rows: ApiRapportPersonnelRow[]) => void
  onExtraChange: (entries: ApiRapportExtraPersonnel[]) => void
}

export function FeldPersonnelChecklist({
  rows,
  extra,
  candidates = [],
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

  /** Adds a name — or re-ticks the row of somebody removed a moment ago. */
  const add = (candidate: ApiRapportPersonnelCandidate) => {
    if (rows.some(row => row.personnel_id === candidate.personnel_id)) {
      onChange(rows.map(row => (row.personnel_id === candidate.personnel_id ? { ...row, present: true } : row)))
      return
    }
    onChange([...rows, { personnel_id: candidate.personnel_id, name: candidate.name, present: true, on_board: false }])
  }

  /**
   * Removing an added row **unticks** it rather than dropping it.
   *
   * Dropping it would look identical on screen and lose the removal on the way
   * out: the save reconciles the payload against what is stored, so a row the
   * payload never mentions is simply kept — that is what stops a stale phone
   * from deleting a name somebody added on the other one. An unticked row for
   * somebody nobody dispatched carries no answer at all, so `_jsonable_personnel`
   * does not write it and the next load has no row for them.
   */
  const remove = (personnelId: string) => {
    onChange(rows.map(row => (row.personnel_id === personnelId ? { ...row, present: false } : row)))
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

  // What the board sent here versus what the crew added. An unticked dispatched
  // person stays in the first group — answering "nein, der war nicht dabei" must
  // not make the row jump away as the answer is given, or it looks like a
  // deletion rather than a correction.
  //
  // An added row that has been unticked is a removal in flight (see `remove`):
  // it stays in the form so the save carries the "nein", and it shows nowhere.
  const { dispatched, added } = useMemo(() => {
    const dispatched: ApiRapportPersonnelRow[] = []
    const added: ApiRapportPersonnelRow[] = []
    for (const row of rows) {
      if (row.on_board) dispatched.push(row)
      else if (row.present) added.push(row)
    }
    return { dispatched, added }
  }, [rows])

  const listedCandidates = useMemo(() => {
    // A row that is neither dispatched nor ticked is a removal in flight — the
    // person is offerable again, or a removal could not be taken back.
    const listed = candidates.filter(
      candidate =>
        !rows.some(row => row.personnel_id === candidate.personnel_id && (row.on_board || row.present)),
    )
    if (!needle) return listed
    return listed.filter(candidate => candidate.name.toLowerCase().includes(needle))
  }, [candidates, rows, needle])

  // Without a dispatched list there is nothing to confirm, and a closed fold
  // over an empty section is a dead end: the Appell opens by itself. The
  // Fahrzeuge section deliberately does NOT do this — "kein Fahrzeug" is a
  // normal, often correct result, "niemand war da" is not.
  const listOpen = showAll || needle.length > 0 || dispatched.length === 0

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------- bestätigen */}
      <div className="space-y-1.5">
        {dispatched.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t('empty')}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('dispatchedLabel')}</p>
            {dispatched.map(row => (
              <PersonRow key={row.personnel_id} row={row} disabled={disabled} onToggle={toggle} />
            ))}
          </>
        )}
      </div>

      {/* ------------------------------------- suchen und ergänzen */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('addLabel')}</p>

        {(added.length > 0 || extra.length > 0) && (
          <div className="space-y-1.5">
            {added.map(row => (
              <AddedRow
                key={row.personnel_id}
                name={row.name}
                disabled={disabled}
                onRemove={() => remove(row.personnel_id)}
              />
            ))}
            {extra.map((entry, index) => (
              <AddedRow
                key={`${entry.name}-${index}`}
                name={entry.name}
                note={entry.note}
                disabled={disabled}
                onRemove={() => removeExtra(index)}
              />
            ))}
          </div>
        )}

        {candidates.length > 0 && (
          <>
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t('searchPlaceholder')}
              disabled={disabled}
            />
            {!listOpen ? (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground"
                onClick={() => setShowAll(true)}
              >
                <ChevronDown className="h-4 w-4 shrink-0" />
                {t('showRest', { count: listedCandidates.length })}
              </button>
            ) : (
              <>
                {/* No collapse control while a search is running: the name the
                    crew searched for is in here, and hiding it again behind a
                    chevron is the opposite of what they asked for. */}
                {showAll && !needle && dispatched.length > 0 && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-xs text-muted-foreground"
                    onClick={() => setShowAll(false)}
                  >
                    <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                    {t('hideRest')}
                  </button>
                )}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {listedCandidates.map(candidate => (
                    <button
                      key={candidate.personnel_id}
                      type="button"
                      disabled={disabled}
                      // No aria-label: the name IS the accessible name, exactly
                      // as in the material catalogue's pick buttons. A label
                      // saying «X hinzufügen» would be the same string on every
                      // row of the list with only the name to tell them apart.
                      onClick={() => add(candidate)}
                      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border/50 px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-secondary/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm">{candidate.name}</span>
                      {/* The one thing the roster cannot say: this person was at
                          the Appell tonight, so they were plausibly here. */}
                      {candidate.checked_in && (
                        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t('checkedIn')}
                        </span>
                      )}
                    </button>
                  ))}
                  {listedCandidates.length === 0 && (
                    <p className="col-span-full py-2 text-xs text-muted-foreground">{t('noMatch')}</p>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* Somebody on no roster of this station at all. */}
        {!disabled && (
          /* Name, Notiz and the «+» on ONE line — a container query decides, and
             the container is this wrapper rather than the grid itself. That is
             the whole bug the row used to have: `@container` and `@md:` sat on
             the SAME element, and an element cannot query its own width, so the
             columns never applied anywhere. The row stacked into three
             full-width boxes at every width, in the KP panel as much as on a
             phone.

             The threshold is measured against the app's own stylesheet, not
             guessed: at text-xs in Geist the two placeholders want 125px and
             130px, and with two equal columns, gap-2, px-2 and a 32px «+» that
             is met from ~347px of column upwards. The narrowest real mount is
             the board's 420px detail panel, which leaves this block ~347px (420
             less the panel's p-4, the always-on scrollbar and the section's
             border and px-3); /feld gives ~390px. 336px is where the single
             line still reads (the Notiz placeholder loses its last character);
             under that a phone keeps the stacked, thumb-sized shape, which is
             the only place 44px targets are wanted here — the KP is mouse and
             keyboard (see CLAUDE.md). */
          <div className="@container">
            <div className="grid gap-2 @min-[336px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @min-[336px]:items-center">
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder={t('extraNamePlaceholder')}
                maxLength={100}
                className="h-11 px-2 text-sm @min-[336px]:h-8 @min-[336px]:text-xs"
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
                className="h-11 px-2 text-sm @min-[336px]:h-8 @min-[336px]:text-xs"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addExtra()
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                aria-label={t('addExtra')}
                title={t('addExtra')}
                className="h-11 w-full @min-[336px]:h-8 @min-[336px]:w-8"
                disabled={!newName.trim()}
                onClick={addExtra}
              >
                <Plus className="h-4 w-4" />
                {/* Stacked, the button is full width and wants its word. Inline
                    beside the two fields the «+» says it on its own, and the
                    row has no 100px to spend on saying it twice — the label
                    stays the accessible name either way. */}
                <span className="@min-[336px]:hidden">{t('addExtra')}</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One aufgebotene person: the board's answer, with the tick that corrects it.
 *
 * No "aufgeboten" badge any more — every row in this block is aufgeboten, and a
 * label that is true of all of them says nothing.
 */
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

/**
 * Somebody the crew added — from the roster or by hand.
 *
 * There is no "war dabei" tick here and there must not be one: naming somebody
 * in this block already says they were there, so a second control would only
 * ever be ticked. Taking the row away is the way back, exactly as in the
 * "Weiteres gebrauchtes Material" list.
 */
function AddedRow({
  name,
  note,
  disabled,
  onRemove,
}: {
  name: string
  note?: string
  disabled?: boolean
  onRemove: () => void
}) {
  const t = useTranslations('feld.rapport.personnel')
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{name}</span>
        {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
      </span>
      {!disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('removeAria', { name })}
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

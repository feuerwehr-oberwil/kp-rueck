'use client'

/**
 * The Personal section of the Schadenplatz-Rapport.
 *
 * **Confirm what the board sent, add everything else through one picker.** The
 * list used to be the whole Appell — everybody checked in at the Ereignis — plus
 * whoever the board had here. On a storm night that is half the brigade standing
 * in a rapport about one cellar: being checked in says somebody turned out
 * tonight, not that they stood at this address. So a row belongs to the people
 * the board aufgeboten **here** (released assignments and an Auftrag's crew
 * included), arriving ticked, and the crew corrects that in both directions.
 *
 * Nobody becomes unreachable, which matters because this ends on a sheet that
 * feeds paid hours: «Person hinzufügen» opens the roster (`FeldAddPicker`), the
 * Appell first, and adding from it writes a real `personnel_id` rather than a
 * free-text name. Somebody from a neighbouring brigade is on no roster at all:
 * their typed name becomes «‹Name› als Gast hinzufügen», stored as
 * `extra_personnel`. The old Notiz field is gone; notes already on a saved
 * rapport still show beside the name.
 *
 * Same grammar as the Fahrzeuge and Material sections beside it: bestätigen,
 * was zugewiesen war – hinzufügen, was fehlt.
 *
 * Names, never new records: `/feld` writes no attendance row, invents no
 * personnel and creates no assignment.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { UserRound, X } from 'lucide-react'

import { FeldAddPicker, type FeldAddPickerItem } from '@/components/feld/feld-add-picker'
import { Button } from '@/components/ui/button'
import type {
  ApiRapportExtraPersonnel,
  ApiRapportPersonnelCandidate,
  ApiRapportPersonnelRow,
} from '@/lib/api/types'
import { sortByName } from '@/lib/roster-order'

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

  const toggle = (personnelId: string, present: boolean) => {
    onChange(rows.map(row => (row.personnel_id === personnelId ? { ...row, present } : row)))
  }

  /** Adds the picked people — or re-ticks the rows of somebody removed a moment ago. */
  const add = (picked: ApiRapportPersonnelCandidate[]) => {
    const ids = new Set(picked.map(candidate => candidate.personnel_id))
    const next = rows.map(row => (ids.has(row.personnel_id) ? { ...row, present: true } : row))
    for (const candidate of picked) {
      if (rows.some(row => row.personnel_id === candidate.personnel_id)) continue
      next.push({ personnel_id: candidate.personnel_id, name: candidate.name, present: true, on_board: false })
    }
    onChange(next)
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

  const removeExtra = (index: number) => {
    onExtraChange(extra.filter((_, i) => i !== index))
  }

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

  // What the picker offers: the Appell under «Heute anwesend», the rest under
  // «Alle», each by name like every roster list (`sortByName`) — the server
  // sends them in rank order, which nobody searching for a name can follow.
  // A row that is neither dispatched nor ticked is a removal in flight — the
  // person is offerable again, or a removal could not be taken back.
  const pickable = useMemo(() => {
    const listed = sortByName(candidates).filter(
      candidate =>
        !rows.some(row => row.personnel_id === candidate.personnel_id && (row.on_board || row.present)),
    )
    const items = (checkedIn: boolean): FeldAddPickerItem[] =>
      listed
        .filter(candidate => candidate.checked_in === checkedIn)
        .map(candidate => ({
          key: candidate.personnel_id,
          name: candidate.name,
          group: checkedIn ? t('groupCheckedIn') : t('groupAll'),
        }))
    return [...items(true), ...items(false)]
  }, [candidates, rows, t])

  const takenNames = useMemo(
    () => [...dispatched.map(row => row.name), ...added.map(row => row.name), ...extra.map(entry => entry.name)],
    [dispatched, added, extra],
  )

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

      {/* ------------------------------------------- hinzufügen */}
      <div className="space-y-2">
        {(added.length > 0 || extra.length > 0) && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('addLabel')}</p>
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
                guest
                disabled={disabled}
                onRemove={() => removeExtra(index)}
              />
            ))}
          </div>
        )}

        {!disabled && (
          <FeldAddPicker
            label={t('add')}
            searchPlaceholder={t('searchPlaceholder')}
            items={pickable}
            freeTextLabel={name => t('addGuest', { name })}
            freeTextHint={t('guest')}
            takenNames={takenNames}
            onAdd={(picked, guests) => {
              const byId = new Map(candidates.map(candidate => [candidate.personnel_id, candidate]))
              if (picked.length > 0) add(picked.flatMap(item => byId.get(item.key) ?? []))
              if (guests.length > 0) onExtraChange([...extra, ...guests.map(name => ({ name, note: '' }))])
            }}
          />
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
  // The whole row is the label, so the whole row is the tap target — at least
  // 44px high on a phone; the 16px box inside it is not what a thumb aims at.
  return (
    <label className="flex max-md:min-h-11 pointer-coarse:min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words text-sm">{row.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 cursor-pointer accent-sel max-md:size-5"
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
  guest,
  disabled,
  onRemove,
}: {
  name: string
  /** A saved rapport's note from before the Notiz field went – shown, no longer typed. */
  note?: string
  guest?: boolean
  disabled?: boolean
  onRemove: () => void
}) {
  const t = useTranslations('feld.rapport.personnel')
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words text-sm">{name}</span>
        {guest && (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">{t('guest')}</span>
        )}
        {note && <span className="min-w-0 break-words text-xs text-muted-foreground">{note}</span>}
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

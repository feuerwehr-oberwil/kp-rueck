'use client'

/**
 * The Mannschaft section of the Schadenplatz-Rapport: one chip per person who
 * was there, a ✕ to take somebody out, a dashed «+ Person» to add somebody
 * (owner pick 1B «Compact chips», 24.11.2026).
 *
 * **Confirm what the board sent, add everything else through one picker.** The
 * list used to be the whole Appell — everybody checked in at the Ereignis — plus
 * whoever the board had here. On a storm night that is half the brigade standing
 * in a rapport about one cellar: being checked in says somebody turned out
 * tonight, not that they stood at this address. So the people the board
 * aufgeboten **here** (released assignments and an Auftrag's crew included)
 * arrive as chips, and the crew corrects that in both directions.
 *
 * **A ✕ is a «nein», never a deletion.** It sets `present: false` on the row —
 * exactly what unticking «war dabei» did before the chips. An aufgebotene person
 * keeps the row, so the save carries the correction; an added one keeps it until
 * the save, which then does not write it (see `remove`). Either way the person
 * shows up again in «+ Person» (under «Aufgeboten» when the board sent them),
 * which is how a removal is taken back.
 *
 * Nobody becomes unreachable, which matters because this ends on a sheet that
 * feeds paid hours: «+ Person» opens the roster (`FeldAddPicker`), the Appell
 * first, and adding from it writes a real `personnel_id` rather than a
 * free-text name. Somebody from a neighbouring brigade is on no roster at all:
 * their typed name becomes «‹Name› als Gast hinzufügen», stored as
 * `extra_personnel`. The old Notiz field is gone; notes already on a saved
 * rapport still show on the chip.
 *
 * Same grammar as the Fahrzeuge and Material sections beside it. Names, never
 * new records: `/feld` writes no attendance row, invents no personnel and
 * creates no assignment.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { FeldAddPicker, type FeldAddPickerItem } from '@/components/feld/feld-add-picker'
import { FeldChip, FeldChipList } from '@/components/feld/feld-chip'
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
  /** The Einsatzleiter: their chip carries «EL». */
  leaderId?: string | null
  disabled?: boolean
  onChange: (rows: ApiRapportPersonnelRow[]) => void
  onExtraChange: (entries: ApiRapportExtraPersonnel[]) => void
}

export function FeldPersonnelChecklist({
  rows,
  extra,
  candidates = [],
  leaderId,
  disabled,
  onChange,
  onExtraChange,
}: FeldPersonnelChecklistProps) {
  const t = useTranslations('feld.rapport.personnel')

  /** Adds the picked people — or re-ticks the row of somebody taken out a moment ago. */
  const add = (ids: Set<string>) => {
    const next = rows.map(row => (ids.has(row.personnel_id) ? { ...row, present: true } : row))
    for (const candidate of candidates) {
      if (!ids.has(candidate.personnel_id)) continue
      if (rows.some(row => row.personnel_id === candidate.personnel_id)) continue
      next.push({ personnel_id: candidate.personnel_id, name: candidate.name, present: true, on_board: false })
    }
    onChange(next)
  }

  /**
   * The ✕ **unticks** the row rather than dropping it.
   *
   * For an aufgebotene person that IS the answer («nein, der war nicht dabei»).
   * For an added one, dropping it would look identical on screen and lose the
   * removal on the way out: the save reconciles the payload against what is
   * stored, so a row the payload never mentions is simply kept — that is what
   * stops a stale phone from deleting a name somebody added on the other one.
   * An unticked row for somebody nobody dispatched carries no answer at all, so
   * `_jsonable_personnel` does not write it and the next load has no row for them.
   */
  const remove = (personnelId: string) => {
    onChange(rows.map(row => (row.personnel_id === personnelId ? { ...row, present: false } : row)))
  }

  const removeExtra = (index: number) => {
    onExtraChange(extra.filter((_, i) => i !== index))
  }

  const present = useMemo(() => rows.filter(row => row.present), [rows])

  // What the picker offers. First whoever the board sent here and the crew took
  // out (their row is still in the form), then the Appell under «Heute
  // anwesend» and the rest under «Alle», each by name like every roster list
  // (`sortByName`) — the server sends rank order, which nobody searching for a
  // name can follow. An added row that was taken out again is a removal in
  // flight: that person is a candidate, and offered again.
  const pickable = useMemo(() => {
    const dispatchedOut: FeldAddPickerItem[] = sortByName(rows.filter(row => row.on_board && !row.present)).map(
      row => ({ key: row.personnel_id, name: row.name, group: t('groupDispatched') }),
    )
    const listed = sortByName(candidates).filter(
      candidate => !rows.some(row => row.personnel_id === candidate.personnel_id && (row.on_board || row.present)),
    )
    const items = (checkedIn: boolean): FeldAddPickerItem[] =>
      listed
        .filter(candidate => candidate.checked_in === checkedIn)
        .map(candidate => ({
          key: candidate.personnel_id,
          name: candidate.name,
          group: checkedIn ? t('groupCheckedIn') : t('groupAll'),
        }))
    return [...dispatchedOut, ...items(true), ...items(false)]
  }, [candidates, rows, t])

  const takenNames = useMemo(
    () => [...present.map(row => row.name), ...extra.map(entry => entry.name)],
    [present, extra],
  )

  return (
    <FeldChipList label={t('listLabel')}>
      {present.length === 0 && extra.length === 0 && <li className="text-sm text-muted-foreground">{t('empty')}</li>}
      {present.map(row => (
        <FeldChip
          key={row.personnel_id}
          removeLabel={t('removeAria', { name: row.name })}
          onRemove={disabled ? undefined : () => remove(row.personnel_id)}
        >
          {row.personnel_id === leaderId && (
            // A fact, so the neutral ink chip (DESIGN.md «Facts are ink»).
            <span
              title={t('leaderTitle')}
              className="shrink-0 rounded-sm bg-foreground/10 px-1 text-2xs font-semibold text-foreground"
            >
              {t('leader')}
            </span>
          )}
          <span className="min-w-0 break-words">{row.name}</span>
        </FeldChip>
      ))}
      {extra.map((entry, index) => (
        <FeldChip
          key={`${entry.name}-${index}`}
          removeLabel={t('removeAria', { name: entry.name })}
          onRemove={disabled ? undefined : () => removeExtra(index)}
        >
          <span className="min-w-0 break-words">{entry.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{t('guest')}</span>
          {/* A saved rapport's note from before the Notiz field went – shown, no longer typed. */}
          {entry.note && <span className="min-w-0 break-words text-xs text-muted-foreground">· {entry.note}</span>}
        </FeldChip>
      ))}
      {!disabled && (
        <li>
          <FeldAddPicker
            label={t('add')}
            chipLabel={t('addChip')}
            searchPlaceholder={t('searchPlaceholder')}
            items={pickable}
            freeTextLabel={name => t('addGuest', { name })}
            freeTextHint={t('guest')}
            takenNames={takenNames}
            onAdd={(picked, guests) => {
              if (picked.length > 0) add(new Set(picked.map(item => item.key)))
              if (guests.length > 0) onExtraChange([...extra, ...guests.map(name => ({ name, note: '' }))])
            }}
          />
        </li>
      )}
    </FeldChipList>
  )
}

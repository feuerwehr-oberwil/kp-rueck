"use client"

import { useTranslations } from "next-intl"
import { type Person } from "@/lib/contexts/operations-context"
import { type PersonTileFacts } from "@/components/kanban/person-tile-facts"
import { ListSection, PersonPickTile, TILE_GRID } from "@/components/kanban/assignment-list-section"

/**
 * The crew half of `ResourceAssignmentDialog`: the free block, then the spoken-for block, each
 * a grid of person tiles. The dialog keeps the state and the sorting (the 1–9 keys need the
 * same order) and passes each tile's facts, its tick and the toggle. `allBusyText` is the line
 * where the free block would be when nobody in the list is free.
 */
export function CrewAssignmentList({
  free,
  busy,
  allBusyText,
  isPersonSelected,
  justAssigned,
  tileFacts,
  onTogglePerson,
}: {
  free: Person[]
  busy: Person[]
  allBusyText: string | null
  isPersonSelected: (personId: string) => boolean
  justAssigned: string | null
  tileFacts: (person: Person) => PersonTileFacts
  onTogglePerson: (person: Person) => void
}) {
  const t = useTranslations('kanban')

  /** One crew tile. Lifted out of the grid so the free and the spoken-for
   *  block can draw the same thing without a second copy of it. */
  const renderPersonTile = (person: Person) => {
    const isSelected = isPersonSelected(person.id)
    const wasJustAssigned = justAssigned === person.id
    // Already on another incident/Auftrag → the amber where-note names it; else a
    // place-like role (Reko, Magazin, …; never the driven vehicle) does. The tile
    // itself stays neutral: the note says where, no tinted block.
    const { where, roles, plan } = tileFacts(person)
    return (
      // ONE line for every person tile, busy or free: rank · where · roles
      // (`PersonTileLine` says why). «Im Einsatz» and the Ereignis roles are
      // different facts and both stay: where somebody is now, and what taking
      // them costs the Ereignis (the TLF 1's driver). A person on no Einsatz
      // but in Reko/Magazin … is THERE – that role is the where-note.
      <PersonPickTile
        key={person.id}
        name={person.name}
        kennung={person.kennung ?? null}
        rank={person.role}
        where={where}
        roles={roles}
        plan={plan}
        checked={isSelected}
        animate={wasJustAssigned}
        onClick={() => onTogglePerson(person)}
      />
    )
  }

  return (
    <div className="space-y-4">
      {allBusyText !== null && (
        <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: 0 })}>
          <p className="text-sm text-muted-foreground">{allBusyText}</p>
        </ListSection>
      )}
      {free.length > 0 && (
        <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: free.length })}>
          <div className={TILE_GRID}>
            {free.map(renderPersonTile)}
          </div>
        </ListSection>
      )}
      {busy.length > 0 && (
        <ListSection tone="busy" label={t('assignmentDialog.sectionBusy', { count: busy.length })}>
          <div className={TILE_GRID}>
            {busy.map(renderPersonTile)}
          </div>
        </ListSection>
      )}
    </div>
  )
}

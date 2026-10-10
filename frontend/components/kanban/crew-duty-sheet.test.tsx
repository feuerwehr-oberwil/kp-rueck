import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Person } from '@/lib/contexts/operations-context'
import type { PersonEngagement } from '@/lib/hooks/use-person-engagements'

const getEventPersonnelActivity = vi.fn()

vi.mock('@/lib/api-client', () => ({
  apiClient: { getEventPersonnelActivity: (...args: unknown[]) => getEventPersonnelActivity(...args) },
}))
// Desktop branch of the footer sheet.
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))
// The chip's right-click menu needs the whole board's contexts; not under test here.
vi.mock('@/components/kanban/person-context-menu', () => ({
  PersonContextMenu: ({ children }: { children: React.ReactNode }) => children,
}))

import { CrewDutySheet } from '@/components/kanban/crew-duty-sheet'
import { DraggablePerson } from '@/components/kanban/draggable-person'

const NOW = new Date('2026-10-08T20:00:00Z')
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()

function person(name: string, minutesOnDuty: number | null, extra: Partial<Person> = {}): Person {
  return {
    id: `id-${name}`,
    name,
    role: 'Wachtmeister',
    status: 'available',
    roleSortOrder: 1,
    checkedInAt: minutesOnDuty === null ? null : ago(minutesOnDuty),
    ...extra,
  }
}

const hans = person('Müller Hans', 400, { status: 'assigned' })
const anna = person('Meier Anna', 250, { isTelefondienst: true })
const eva = person('Frisch Eva', 20)

const engagements = new Map<string, PersonEngagement>([
  ['Müller Hans', { short: 'Langegasse 28', full: 'Langegasse 28 (Brand Dachstock)' } as PersonEngagement],
])

describe('CrewDutySheet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(NOW)
    getEventPersonnelActivity.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function renderSheet() {
    return renderWithIntl(
      <CrewDutySheet
        open
        onOpenChange={() => {}}
        eventId="event-1"
        personnel={[eva, anna, hans]}
        personEngagements={engagements}
        fatigueHours={4}
      />,
    )
  }

  it('lists the longest on duty first, with time, Einsätze and where they are now', async () => {
    getEventPersonnelActivity.mockResolvedValue([
      { personnel_id: hans.id, assignment_count: 4 },
      { personnel_id: anna.id, assignment_count: 1 },
      { personnel_id: eva.id, assignment_count: 0 },
    ])
    renderSheet()

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => within(row).getAllByText(/./)[0].textContent)).toEqual([
      'Müller Hans',
      'Meier Anna',
      'Frisch Eva',
    ])
    

    // 400 min = 6h 40' → red; 250 min → amber; 20 min → calm.
    expect(within(rows[0]).getByText("6h 40'")).toHaveAttribute('data-duty-level', 'over')
    expect(within(rows[1]).getByText("4h 10'")).toHaveAttribute('data-duty-level', 'long')
    expect(within(rows[2]).getByText("20'")).toHaveAttribute('data-duty-level', 'normal')

    await waitFor(() => expect(within(rows[0]).getAllByText('4').length).toBeGreaterThan(0))
    expect(getEventPersonnelActivity).toHaveBeenCalledWith('event-1')
    // «Jetzt»: the board's own engagement, the function as fallback, else «frei».
    expect(within(rows[0]).getAllByText('Langegasse 28').length).toBeGreaterThan(0)
    expect(within(rows[1]).getAllByText('Telefondienst').length).toBeGreaterThan(0)
    expect(within(rows[2]).getAllByText('frei').length).toBeGreaterThan(0)

    expect(screen.getByText('3 anwesend · 2 über 4 h')).toBeInTheDocument()
  })

  it('asks again when an assignment changes, and only then', async () => {
    getEventPersonnelActivity.mockResolvedValue([{ personnel_id: hans.id, assignment_count: 4 }])
    const props = {
      open: true,
      onOpenChange: () => {},
      eventId: 'event-1',
      personnel: [eva, anna, hans],
      fatigueHours: 4,
    }
    const view = renderWithIntl(<CrewDutySheet {...props} personEngagements={engagements} />)
    await waitFor(() => expect(getEventPersonnelActivity).toHaveBeenCalledTimes(1))

    // Same assignments, new map identity (the board rebuilds it on every change): no request.
    view.rerender(<CrewDutySheet {...props} personEngagements={new Map(engagements)} />)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(getEventPersonnelActivity).toHaveBeenCalledTimes(1)

    // Eva goes out: ask again.
    const moved = new Map(engagements)
    moved.set('Frisch Eva', { short: 'Hauptstrasse 41', full: 'Hauptstrasse 41' } as PersonEngagement)
    view.rerender(<CrewDutySheet {...props} personEngagements={moved} />)
    await waitFor(() => expect(getEventPersonnelActivity).toHaveBeenCalledTimes(2))
  })

  it('sorts by any column head, again for the other way round, and shows the Pause', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    getEventPersonnelActivity.mockResolvedValue([
      { personnel_id: hans.id, assignment_count: 4, assigned_minutes: 300 },
      { personnel_id: anna.id, assignment_count: 1, assigned_minutes: 10 },
      { personnel_id: eva.id, assignment_count: 0, assigned_minutes: 0 },
    ])
    renderSheet()
    const names = () => screen.getAllByRole('listitem').map((row) => within(row).getAllByText(/./)[0].textContent)
    // Hans: 400' here, 300' out (and out now, so it runs on) → 1h 40' Pause.
    await waitFor(() => expect(within(screen.getAllByRole('listitem')[0]).getByText("1h 40'")).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Einsätze/ }))
    expect(names()).toEqual(['Müller Hans', 'Meier Anna', 'Frisch Eva'])
    await user.click(screen.getByRole('button', { name: /Einsätze/ }))
    expect(names()).toEqual(['Frisch Eva', 'Meier Anna', 'Müller Hans'])
    await user.click(screen.getByRole('button', { name: /Pause/ }))
    expect(names()).toEqual(['Meier Anna', 'Müller Hans', 'Frisch Eva'])

    // Frei / Im Einsatz: Anna's Telefondienst counts as something.
    await user.click(screen.getByRole('button', { name: /^Frei/ }))
    expect(names()).toEqual(['Frisch Eva'])
  })

  it('says it cannot count rather than claiming zero Einsätze', async () => {
    getEventPersonnelActivity.mockRejectedValue(new Error('offline'))
    renderSheet()
    const rows = screen.getAllByRole('listitem')
    await waitFor(() =>
      expect(within(rows[0]).getByTitle('Anzahl Einsätze gerade nicht abrufbar')).toHaveTextContent('–'),
    )
  })

  it('names nobody when nobody is checked in', () => {
    getEventPersonnelActivity.mockResolvedValue([])
    renderWithIntl(
      <CrewDutySheet open onOpenChange={() => {}} eventId="e" personnel={[]} personEngagements={new Map()} fatigueHours={4} />,
    )
    expect(screen.getByText('Niemand eingecheckt.')).toBeInTheDocument()
  })
})

describe('the default views stay quiet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  // Owner, 09.10.2026: the time on duty belongs in the Dienstzeiten sheet, not on every row.
  it('a sidebar person row shows no time on duty, however long they have been here', () => {
    renderWithIntl(<DraggablePerson person={person('Müller Hans', 400)} />)
    expect(screen.getByText('Müller Hans')).toBeInTheDocument()
    expect(document.querySelector('[data-duty-level]')).toBeNull()
    expect(screen.queryByText("6h 40'")).toBeNull()
  })
})

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

describe('DraggablePerson time on duty', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('shows how long a free person has been here, coloured past the threshold', () => {
    renderWithIntl(<DraggablePerson person={person('Meier Anna', 250)} fatigueHours={4} />)
    const time = screen.getByText("4h 10'")
    expect(time).toHaveAttribute('data-duty-level', 'long')
    expect(time.getAttribute('aria-label')).toMatch(/^Seit \d\d:\d\d im Einsatz – 4 Stunden 10 Minuten, über 4 h$/)
  })

  it('stays calm below the threshold and when the setting is off', () => {
    renderWithIntl(
      <>
        <DraggablePerson person={person('Frisch Eva', 20)} fatigueHours={4} />
        <DraggablePerson person={person('Müller Hans', 900)} fatigueHours={0} />
      </>,
    )
    expect(screen.getByText("20'")).toHaveAttribute('data-duty-level', 'normal')
    expect(screen.getByText("15h 0'")).toHaveAttribute('data-duty-level', 'normal')
  })

  it('shows nothing without a check-in stamp', () => {
    renderWithIntl(<DraggablePerson person={person('Ohne Stempel', null)} fatigueHours={4} />)
    expect(document.querySelector('[data-duty-level]')).toBeNull()
  })
})

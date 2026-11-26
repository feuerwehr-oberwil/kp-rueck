import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiPersonnelListItem } from '@/lib/api-client'

const getEventCheckInList = vi.fn()
const checkInPersonnelForEvent = vi.fn().mockResolvedValue({})
const checkOutPersonnelForEvent = vi.fn().mockResolvedValue({})
const notConfigured = { available: false, reason: 'not_configured', counts: { coming: 0, not_coming: 0 } }
const getEventDiveraResponses = vi.fn().mockResolvedValue(notConfigured)
const setAttendancePlan = vi.fn()

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getEventCheckInList: (...args: unknown[]) => getEventCheckInList(...args),
    checkInPersonnelForEvent: (...args: unknown[]) => checkInPersonnelForEvent(...args),
    checkOutPersonnelForEvent: (...args: unknown[]) => checkOutPersonnelForEvent(...args),
    checkOutAllPersonnel: vi.fn().mockResolvedValue([]),
    createPersonnel: vi.fn(),
    getEventDiveraResponses: (...args: unknown[]) => getEventDiveraResponses(...args),
    setAttendancePlan: (...args: unknown[]) => setAttendancePlan(...args),
  },
}))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: { on: () => () => {}, getStatus: () => 'disconnected', onStatusChange: () => () => {} },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// The board: Bürgin Anton is crew of Einsatz 12 (the Appell search finds people there too).
vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({
    personnel: [],
    operations: [
      {
        id: 'op-12', number: 12, location: 'Ringstrasse 4', locationDisplay: null, status: 'active', groupId: null,
        crew: [{ personnelId: 'Bürgin Anton' }], vehicles: [], assignedReko: null,
      },
    ],
  }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ groups: [] }) }))

import {
  AttendanceModal,
  attendanceFacts,
  attendanceState,
  sortAttendance,
  summarizeAttendance,
} from '@/components/kanban/attendance-modal'

function person(overrides: Partial<ApiPersonnelListItem> & { name: string }): ApiPersonnelListItem {
  return {
    id: overrides.name,
    role: 'AdF',
    status: 'available',
    checked_in: false,
    checked_in_at: null,
    checked_out_at: null,
    is_assigned: false,
    kennung: null,
    tags: null,
    planned_from: null,
    planned_until: null,
    ...overrides,
  }
}

const present = person({ name: 'Bürgin Anton', checked_in: true, checked_in_at: '2026-08-10T17:04:00Z' })
const left = person({
  name: 'Hofer Silvia',
  checked_in: false,
  checked_in_at: '2026-08-10T17:07:00Z',
  checked_out_at: '2026-08-10T19:12:00Z',
})
const absent = person({ name: 'Frey Marc' })
const unavailable = person({ name: 'Ammann Urs', status: 'unavailable' })

describe('attendance state', () => {
  it('separates somebody who left from somebody who never came', () => {
    expect(attendanceState(present)).toBe('present')
    expect(attendanceState(left)).toBe('left')
    expect(attendanceState(absent)).toBe('absent')
  })

  it('counts present, gone and the whole roster', () => {
    expect(summarizeAttendance([present, left, absent, unavailable])).toEqual({
      present: 1,
      left: 1,
      total: 4,
    })
  })

  it('counts an unavailable person as roster but never as present', () => {
    expect(summarizeAttendance([unavailable])).toEqual({ present: 0, left: 0, total: 1 })
  })
})

describe('roll-call order', () => {
  it('is alphabetical, not state-first', () => {
    expect(sortAttendance([present, left, absent, unavailable]).map((p) => p.name)).toEqual([
      'Ammann Urs',
      'Bürgin Anton',
      'Frey Marc',
      'Hofer Silvia',
    ])
  })

  it('does not move a row when it is ticked', () => {
    // The list is read off out loud. If ticking a name reordered it, the operator
    // would lose their place mid-Appell — which is the moment this exists for.
    const before = sortAttendance([present, left, absent, unavailable]).map((p) => p.name)
    const ticked = sortAttendance([
      { ...present, checked_in: false, checked_out_at: '2026-08-10T19:30:00Z' },
      left,
      { ...absent, checked_in: true, checked_in_at: '2026-08-10T19:30:00Z' },
      unavailable,
    ]).map((p) => p.name)
    expect(ticked).toEqual(before)
  })
})

describe('what a row says besides the name', () => {
  it('a present person: since when, then where they are assigned', () => {
    expect(attendanceFacts(present, '14 · Talstrasse 25')).toEqual([
      { kind: 'since', time: expect.stringMatching(/^\d\d:\d\d$/) },
      { kind: 'assigned', where: '14 · Talstrasse 25' },
    ])
  })

  it('somebody who left: when they went, never «zugewiesen»', () => {
    expect(attendanceFacts(left, '14 · Talstrasse 25')).toEqual([
      { kind: 'left', time: expect.stringMatching(/^\d\d:\d\d$/) },
    ])
  })

  it('a plan joins the time line: here «since – until», not here yet «ab …»', () => {
    expect(attendanceFacts({ ...present, planned_until: '2026-08-10T20:00:00Z' }, null)).toEqual([
      { kind: 'stay', from: expect.stringMatching(/^\d\d:\d\d$/), until: expect.stringMatching(/^\d\d:\d\d$/) },
    ])
    expect(attendanceFacts({ ...absent, planned_from: '2026-08-10T19:00:00Z' }, null)).toEqual([
      { kind: 'from', time: expect.stringMatching(/^\d\d:\d\d$/) },
    ])
  })

  it('nothing for somebody who never came, «nicht verfügbar» before anything else', () => {
    expect(attendanceFacts(absent, null)).toEqual([])
    expect(attendanceFacts({ ...unavailable, checked_in: true, checked_in_at: present.checked_in_at }, 'x')).toEqual([
      { kind: 'unavailable' },
    ])
  })
})

describe('AttendanceModal on a phone', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    return () => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  })

  it('is a bottom sheet whose rows keep the full name and put the facts on line 2', async () => {
    const longName = 'Birrer-Abdullahi Maximilian Alexander'
    getEventCheckInList.mockResolvedValue({
      personnel: [person({ name: longName, checked_in: true, checked_in_at: '2026-08-10T17:22:00Z' })],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })

    renderWithIntl(
      <AttendanceModal
        open
        onOpenChange={() => {}}
        eventId="ev-1"
        eventName="Unwetter 08.08."
        assignmentLabelFor={() => '14 · Talstrasse 25'}
      />
    )

    const row = await screen.findByRole('button', { name: new RegExp(longName) })
    expect(row.closest('[data-slot="sheet-content"]')).toHaveAttribute('data-side', 'bottom')
    const [nameLine, factsLine] = row.querySelectorAll('span.block')
    expect(nameLine).toHaveTextContent(longName)
    expect(nameLine).not.toHaveClass('truncate')
    expect(factsLine).toHaveTextContent(/^seit \d\d:\d\d · zugewiesen: 14 · Talstrasse 25$/)
    // One action on a phone list: the quick-add in the footer, no «Alle auschecken».
    expect(screen.queryByRole('button', { name: 'Alle auschecken' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Neue Person hinzufügen/ })).toBeInTheDocument()
  })

  it('opens the add form in the footer without a second frame around it', async () => {
    getEventCheckInList.mockResolvedValue({ personnel: [absent], event_id: 'ev-1', event_name: 'Unwetter 08.08.' })

    renderWithIntl(<AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." />)

    await userEvent.click(await screen.findByRole('button', { name: /Neue Person hinzufügen/ }))
    const form = screen.getByPlaceholderText('Name eingeben …').closest('[data-slot="quick-add-form"]')
    expect(form?.closest('[data-slot="sheet-footer"]')).not.toBeNull()
    expect(form).not.toHaveClass('border-2')
  })
})

describe('AttendanceModal', () => {
  beforeEach(() => {
    checkInPersonnelForEvent.mockClear()
    checkOutPersonnelForEvent.mockClear()
  })

  it('shows the three numbers and refuses to offer an action the backend would reject', async () => {
    getEventCheckInList.mockResolvedValue({
      personnel: [present, left, absent, unavailable],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })

    renderWithIntl(
      <AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." />
    )

    expect(await screen.findByText('1 anwesend · 1 gegangen · 4 Personal')).toBeInTheDocument()

    const unavailableRow = screen.getByRole('button', { name: /Ammann Urs/ })
    expect(unavailableRow).toBeDisabled()
    expect(unavailableRow).toHaveTextContent('nicht verfügbar')

    await userEvent.click(unavailableRow)
    expect(checkInPersonnelForEvent).not.toHaveBeenCalled()
  })

  it('checks an absent person in and a present one out from the same target', async () => {
    getEventCheckInList.mockResolvedValue({
      personnel: [present, absent],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })

    renderWithIntl(
      <AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." />
    )

    await userEvent.click(await screen.findByRole('button', { name: /Frey Marc/ }))
    await waitFor(() => expect(checkInPersonnelForEvent).toHaveBeenCalledWith('Frey Marc', 'ev-1'))

    await userEvent.click(screen.getByRole('button', { name: /Bürgin Anton/ }))
    await waitFor(() =>
      expect(checkOutPersonnelForEvent).toHaveBeenCalledWith('Bürgin Anton', 'ev-1')
    )
  })

  it('searches like every person picker: tags and where the person is now', async () => {
    getEventCheckInList.mockResolvedValue({
      personnel: [present, { ...absent, tags: ['Atemschutz'] }, left],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })
    renderWithIntl(<AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." />)
    const search = await screen.findByRole('textbox')

    await userEvent.type(search, 'atemschutz')
    expect(screen.getByRole('button', { name: /Frey Marc/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bürgin Anton/ })).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, '12')
    expect(screen.getByRole('button', { name: /Bürgin Anton/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Frey Marc/ })).not.toBeInTheDocument()
  })

  it('warns before sending home somebody who is still assigned, and only then writes', async () => {
    getEventCheckInList.mockResolvedValue({
      personnel: [present],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })

    renderWithIntl(
      <AttendanceModal
        open
        onOpenChange={() => {}}
        eventId="ev-1"
        eventName="Unwetter 08.08."
        assignmentLabelFor={() => 'Hauptstrasse 12'}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: /Bürgin Anton/ }))
    expect(checkOutPersonnelForEvent).not.toHaveBeenCalled()
    expect(await screen.findByText(/noch «Hauptstrasse 12» zugewiesen/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Trotzdem auschecken' }))
    await waitFor(() =>
      expect(checkOutPersonnelForEvent).toHaveBeenCalledWith('Bürgin Anton', 'ev-1')
    )
  })
})

describe('AttendanceModal · the time line and its clock (pick 2C)', () => {
  beforeEach(() => {
    checkInPersonnelForEvent.mockClear()
    setAttendancePlan.mockReset()
  })

  const clockOf = (iso: string) => {
    const at = new Date(iso)
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  }

  it('one mono line «18:47 – 22:00»; an ink clock with a plan, a pale one without, none on a «gegangen» row', async () => {
    const until = new Date(Date.now() + 3 * 3_600_000)
    until.setMinutes(0, 0, 0)
    const clock = clockOf(until.toISOString())
    getEventCheckInList.mockResolvedValue({
      personnel: [{ ...present, planned_until: until.toISOString() }, absent, left],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })
    renderWithIntl(<AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." canCheckIn />)

    const set = await screen.findByRole('button', { name: `Geht um ${clock} – ändern` })
    expect(set).toHaveClass('text-foreground')
    expect(screen.getByRole('button', { name: /Bürgin Anton/ })).toHaveTextContent(
      `${clockOf(present.checked_in_at!)} – ${clock}`
    )
    expect(screen.getByRole('button', { name: 'Kommt um setzen' })).toHaveClass('text-muted-foreground/50')
    expect(screen.getByRole('button', { name: /Hofer Silvia/ })).toHaveTextContent(`gegangen ${clockOf(left.checked_out_at!)}`)
    expect(screen.getAllByRole('button', { name: /setzen|ändern/ })).toHaveLength(2)
  })

  it('leaving within the hour: amber on the until part, with the time left', async () => {
    const until = new Date(Date.now() + 30 * 60_000).toISOString()
    getEventCheckInList.mockResolvedValue({
      personnel: [{ ...present, planned_until: until }],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })
    renderWithIntl(<AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." canCheckIn />)

    const soon = await screen.findByText(new RegExp(`^${clockOf(until)} · in \\d+'$`))
    expect(soon).toHaveClass('text-warning-foreground')
  })

  it('a click on the clock never cycles the row; Enter in the field writes «kommt um» for that Ereignis', async () => {
    setAttendancePlan.mockResolvedValue({ planned_from: '2026-11-19T19:00:00.000Z', planned_until: null })
    getEventCheckInList.mockResolvedValue({ personnel: [absent], event_id: 'ev-1', event_name: 'Unwetter 08.08.' })
    renderWithIntl(<AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." canCheckIn />)

    await userEvent.click(await screen.findByRole('button', { name: 'Kommt um setzen' }))
    const field = await screen.findByLabelText('Kommt um')
    await userEvent.type(field, '20:00{Enter}')

    await waitFor(() => expect(setAttendancePlan).toHaveBeenCalledTimes(1))
    const [id, door, plan] = setAttendancePlan.mock.calls[0]
    expect([id, door]).toEqual(['Frey Marc', { eventId: 'ev-1' }])
    expect(new Date(plan.planned_from).getHours()).toBe(20)
    expect(checkInPersonnelForEvent).not.toHaveBeenCalled()
  })

  it('a viewer reads the plan but gets no clock to set one', async () => {
    const from = '2026-11-19T19:00:00.000Z'
    getEventCheckInList.mockResolvedValue({
      personnel: [present, { ...absent, planned_from: from }],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })
    renderWithIntl(<AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." />)
    expect(await screen.findByRole('button', { name: /Frey Marc/ })).toHaveTextContent(`ab ${clockOf(from)}`)
    expect(screen.queryByRole('button', { name: /setzen|ändern/ })).not.toBeInTheDocument()
  })
})

describe('AttendanceModal · Divera «Anrückend»', () => {
  const answer = (name: string, extra: Record<string, unknown> = {}) => ({
    personnel_id: name,
    name,
    role: null,
    tags: [],
    kind: 'coming',
    attended: false,
    ...extra,
  })
  const responses = {
    available: true,
    reason: null,
    alarm_count: 1,
    counts: { coming: 5, not_coming: 1 },
    people: [
      answer('Frey Marc', { role: 'Korporal' }),
      answer('Bürgin Anton'),
      answer('Keller Lea', { kind: 'not_coming' }),
      // Came and went home again (state «gegangen» in the roll-call): not «anrückend».
      answer('Hofer Silvia'),
      // Flagged by the backend (an attendance record this surface has not loaded).
      answer('Gasser Rita', { attended: true }),
    ],
    unmapped: 1,
    updated_at: '2026-10-08T19:42:00Z',
  }

  beforeEach(() => {
    checkInPersonnelForEvent.mockClear()
    getEventCheckInList.mockResolvedValue({
      personnel: [present, left, absent],
      event_id: 'ev-1',
      event_name: 'Unwetter 08.08.',
    })
    getEventDiveraResponses.mockResolvedValue(responses)
  })

  it('lists who is still coming, never anybody who attended, and checks in only on a click', async () => {
    renderWithIntl(
      <AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." canCheckIn />
    )

    const block = await screen.findByTestId('divera-incoming')
    // Bürgin Anton is checked in, Hofer Silvia went home, Gasser Rita is flagged.
    expect(block).toHaveTextContent('Anrückend (1)')
    expect(block).toHaveTextContent('5 kommen · 1 kommt nicht')
    expect(block).not.toHaveTextContent('Bürgin Anton')
    expect(block).not.toHaveTextContent('Hofer Silvia')
    expect(block).not.toHaveTextContent('Gasser Rita')
    expect(block).toHaveTextContent('Frey Marc')
    expect(block).toHaveTextContent('Kpl')
    expect(block).toHaveTextContent('1 Rückmeldung ohne Person im Bestand')
    // Yes/no only: no answer time, estimate or status name.
    expect(block).not.toHaveTextContent(/Antwort|ca\.|Komme/)
    // The answer alone wrote nothing.
    expect(checkInPersonnelForEvent).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Frey Marc als anwesend melden' }))
    await waitFor(() => expect(checkInPersonnelForEvent).toHaveBeenCalledWith('Frey Marc', 'ev-1'))
  })

  it('shows «kommt nicht» as its own group, in words, with check-in still offered', async () => {
    renderWithIntl(
      <AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." canCheckIn />
    )

    const block = await screen.findByTestId('divera-incoming')
    expect(block).toHaveTextContent('Kommt nicht (1)')
    const row = block.querySelector('li[data-kind="not_coming"]') as HTMLElement
    expect(row).toHaveTextContent('Keller Lea')
    expect(row).toHaveTextContent('kommt nicht')
    expect(row.className).not.toMatch(/red|destructive/)
    expect(screen.getByRole('button', { name: 'Keller Lea als anwesend melden' })).toBeEnabled()
  })

  it('is neither fetched nor rendered for a viewer (the endpoint is editor-only)', async () => {
    getEventDiveraResponses.mockClear()
    renderWithIntl(<AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." />)
    expect(await screen.findByText('1 anwesend · 1 gegangen · 3 Personal')).toBeInTheDocument()
    expect(screen.queryByTestId('divera-incoming')).not.toBeInTheDocument()
    expect(getEventDiveraResponses).not.toHaveBeenCalled()
  })

  it('is simply absent when nothing recent here came from Divera', async () => {
    getEventDiveraResponses.mockResolvedValue({ ...notConfigured, reason: 'no_data' })
    renderWithIntl(
      <AttendanceModal open onOpenChange={() => {}} eventId="ev-1" eventName="Unwetter 08.08." canCheckIn />
    )
    expect(await screen.findByText('1 anwesend · 1 gegangen · 3 Personal')).toBeInTheDocument()
    await waitFor(() => expect(getEventDiveraResponses).toHaveBeenCalled())
    expect(screen.queryByTestId('divera-incoming')).not.toBeInTheDocument()
  })
})

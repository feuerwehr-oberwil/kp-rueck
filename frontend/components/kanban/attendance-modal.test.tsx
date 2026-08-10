import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiPersonnelListItem } from '@/lib/api-client'

const getEventCheckInList = vi.fn()
const checkInPersonnelForEvent = vi.fn().mockResolvedValue({})
const checkOutPersonnelForEvent = vi.fn().mockResolvedValue({})

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getEventCheckInList: (...args: unknown[]) => getEventCheckInList(...args),
    checkInPersonnelForEvent: (...args: unknown[]) => checkInPersonnelForEvent(...args),
    checkOutPersonnelForEvent: (...args: unknown[]) => checkOutPersonnelForEvent(...args),
    checkOutAllPersonnel: vi.fn().mockResolvedValue([]),
    createPersonnel: vi.fn(),
  },
}))
vi.mock('@/lib/websocket-client', () => ({ wsClient: { on: () => () => {} } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import {
  AttendanceModal,
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

  it('counts present, gone and the whole Mannschaft', () => {
    expect(summarizeAttendance([present, left, absent, unavailable])).toEqual({
      present: 1,
      left: 1,
      total: 4,
    })
  })

  it('counts an unavailable person as Mannschaft but never as present', () => {
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

    expect(await screen.findByText('1 anwesend · 1 gegangen · 4 Mannschaft')).toBeInTheDocument()

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
    expect(await screen.findByText(/noch an Hauptstrasse 12 zugeteilt/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Trotzdem abmelden' }))
    await waitFor(() =>
      expect(checkOutPersonnelForEvent).toHaveBeenCalledWith('Bürgin Anton', 'ev-1')
    )
  })
})

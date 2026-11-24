/**
 * The phone's «Meldungen» sheet (owner pick 1A, phone sweep 24.11.2026): the Alarmeingang it
 * counts is its first row, and it works nothing on the board – the phone board is read-only
 * (owner, 14.11.2026). «Gesehen» stays: it only closes the bell entry.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiFieldRequest } from '@/lib/api-client'

const openAlarmInbox = vi.hoisted(() => vi.fn())

const request: ApiFieldRequest = {
  id: 'r1',
  incident_id: 'i1',
  kind: 'material',
  status: 'open',
  text: null,
  item: 'Wassersauger',
  quantity: 2,
  label: 'Material',
  created_at: '2026-11-24T10:00:00Z',
  created_by_name: 'Müller Hans',
  from_field: true,
  notification_id: 'n1',
  seen_at: null,
  in_progress_at: null,
  in_progress_by_name: null,
  done_at: null,
  done_by_name: null,
}

vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ isEditor: true, isAuthenticated: true }) }))
vi.mock('@/lib/contexts/notification-context', () => ({
  useNotifications: () => ({
    notifications: [],
    dismissNotification: vi.fn(),
    dismissAllNotifications: vi.fn(),
    navigateToIncident: vi.fn(),
    // the board registers one on the phone too; the sheet must not offer it
    assignAction: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/use-field-requests', () => ({
  useOpenFieldRequests: () => ({
    items: [{ request, operation: { id: 'i1', location: 'Hauptstrasse 4' } }],
    representedIds: new Set(['n1']),
  }),
  useFieldRequestActions: () => ({ setStatus: vi.fn(), markSeen: vi.fn(), canMarkSeen: true, busyId: null }),
}))
vi.mock('@/lib/incident-types', () => ({ getIncidentLocationLabel: () => 'Hauptstrasse 4' }))
vi.mock('@/components/alarm-inbox/alarm-inbox-store', () => ({ openAlarmInbox }))
vi.mock('@/components/alarm-inbox/alarm-inbox-button', () => ({
  AlarmInboxMenuCount: () => <span>2</span>,
  useNewAlarmCount: () => 2,
}))

import { PhoneNotificationSheet } from './phone-notification-sheet'

describe('PhoneNotificationSheet', () => {
  it('shows an editor the open request with «Gesehen», but nothing that works it', () => {
    renderWithIntl(<PhoneNotificationSheet open onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Gesehen/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /Erledigt/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /zuweisen/ })).toBeNull()
  })

  it('hands over to the Alarmeingang it counts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onOpenChange = vi.fn()
    renderWithIntl(<PhoneNotificationSheet open onOpenChange={onOpenChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Alarmeingang/ }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    vi.advanceTimersByTime(400)
    expect(openAlarmInbox).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})

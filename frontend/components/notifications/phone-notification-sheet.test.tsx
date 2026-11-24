/**
 * The phone's «Meldungen» sheet (owner pick 1A, phone sweep 24.11.2026): the Alarmeingang it
 * counts is its first row, and it works nothing on the board – the phone board is read-only
 * (owner, 14.11.2026). «Gesehen» stays: it only closes the bell entry.
 */
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiFieldRequest } from '@/lib/api-client'
import type { Notification } from '@/lib/types/notification'

const openAlarmInboxFrom = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ isViewer: false }))
const notifications = vi.hoisted(() => ({ list: [] as Notification[] }))

/** One active bell entry of its own (not a field request's). */
const activeNotification: Notification = {
  id: 'n2',
  type: 'no_personnel',
  severity: 'warning',
  message: 'Kein Personal zugewiesen',
  created_at: new Date('2026-11-24T10:05:00Z'),
  dismissed: false,
}

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

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ isEditor: !auth.isViewer, isViewer: auth.isViewer, isAuthenticated: true }),
}))
vi.mock('@/lib/contexts/notification-context', () => ({
  useOptionalNotifications: () => null,
  useNotifications: () => ({
    notifications: notifications.list,
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
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ operations: [] }) }))
vi.mock('@/lib/incident-types', () => ({ getIncidentLocationLabel: () => 'Hauptstrasse 4' }))
// One «Danach frei» to-do: the phone shows it, but answers it on the desk only.
const danach = vi.hoisted(() => ({
  kind: 'danach' as const,
  id: 'danach:i2',
  since: 0,
  dismissed: false,
  incidentId: 'i2',
  holderId: 'i2',
  holderLabel: '2 · Mühlemattstrasse 12',
  names: ['TLF'],
  plans: [],
}))
vi.mock('@/lib/hooks/use-todos', () => ({ useTodos: () => ({ open: [danach], dismissed: [], now: 60_000, count: 1, overdue: false, unreadMessages: 0 }) }))
vi.mock('@/components/alarm-inbox/alarm-inbox-store', () => ({ openAlarmInboxFrom }))
vi.mock('@/components/alarm-inbox/alarm-inbox-button', () => ({
  AlarmInboxMenuCount: () => <span>2</span>,
  useNewAlarmCount: () => 2,
}))

import { PhoneNotificationSheet } from './phone-notification-sheet'

describe('PhoneNotificationSheet', () => {
  beforeEach(() => {
    auth.isViewer = false
    notifications.list = []
    openAlarmInboxFrom.mockClear()
  })

  it('shows an editor the open request with «Gesehen», but nothing that works it', () => {
    renderWithIntl(<PhoneNotificationSheet open onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Gesehen/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /Erledigt/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /zuweisen/ })).toBeNull()
  })

  // One layer at a time: the inbox opens once this sheet is gone, not on a timer that could
  // land over whatever the operator opened meanwhile.
  it('hands over to the Alarmeingang once it has closed', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return <PhoneNotificationSheet open={open} onOpenChange={setOpen} />
    }
    renderWithIntl(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /Alarmeingang/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(openAlarmInboxFrom).toHaveBeenCalledOnce()
  })

  // A viewer reads the list (owner pick 4A, 24.11.2026): the Alarmeingang refuses the role, and
  // «Gesehen» and dismissing are POST …/dismiss, an editor's.
  it('offers a viewer no Alarmeingang, no «Gesehen» and nothing to dismiss', () => {
    auth.isViewer = true
    notifications.list = [activeNotification]
    renderWithIntl(<PhoneNotificationSheet open onOpenChange={() => {}} />)
    expect(screen.getByText('Wassersauger', { exact: false })).toBeDefined()
    expect(screen.queryByRole('button', { name: /Alarmeingang/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Gesehen/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /schliessen/ })).toBeNull()
  })

  it('lets an editor dismiss what the viewer cannot', () => {
    notifications.list = [activeNotification]
    renderWithIntl(<PhoneNotificationSheet open onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Alle schliessen' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Benachrichtigung schliessen' })).toBeDefined()
  })

  // Owner pick 24.11.2026: the tile is the phone's loud bell; the answers stay on the desk.
  it('lists «Zu erledigen» first, without its buttons', () => {
    renderWithIntl(<PhoneNotificationSheet open onOpenChange={() => {}} />)
    expect(screen.getByText('Zu erledigen')).toBeDefined()
    expect(screen.getByText(/TLF → 2 · Mühlemattstrasse 12/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Zuteilen/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull()
  })
})

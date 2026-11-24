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

const openAlarmInbox = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ isViewer: false }))

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
  beforeEach(() => {
    auth.isViewer = false
    openAlarmInbox.mockClear()
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
    expect(openAlarmInbox).toHaveBeenCalledOnce()
  })

  it('offers a viewer no Alarmeingang – it refuses the viewer role', () => {
    auth.isViewer = true
    renderWithIntl(<PhoneNotificationSheet open onOpenChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /Alarmeingang/ })).toBeNull()
  })
})

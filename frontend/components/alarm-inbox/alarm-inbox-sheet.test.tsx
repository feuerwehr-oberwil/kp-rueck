/**
 * The Alarmeingang sheet against a stubbed pool: the three sections, the Einsatz number an
 * attached alarm became, «Früher» folded, «Anhängen» per row into the attach dialog, the
 * header icon's count, a failed load that says so – and nothing at all for a viewer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'

import de from '@/messages/de.json'
import type { ApiDiveraEmergency } from '@/lib/api-client'

const auth = vi.hoisted(() => ({
  current: { user: { role: 'editor' }, isAuthenticated: true, isEditor: true, isViewer: false },
}))
const pool = vi.hoisted(() => ({
  emergencies: [] as ApiDiveraEmergency[],
  /** the pool fetch throws while set */
  fail: false,
  events: [{ id: 'ev', name: 'Unwetter Oberwil', training_flag: false }],
  /** settles the attach request the test started */
  finishAttach: null as (() => void) | null,
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth.current }))
vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({ operations: [{ id: 'inc-6', number: 6 }] }),
}))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: { id: 'ev' } }) }))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: () => () => {},
    onStatusChange: () => () => {},
    getStatus: () => 'connected',
  },
}))
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: {
    getDiveraEmergencies: async () => {
      if (pool.fail) throw new Error('Verbindung zum Server unterbrochen')
      return { emergencies: pool.emergencies, total: pool.emergencies.length, unattached_count: 0 }
    },
    getDemoStatus: async () => null,
    getEvents: async () => ({ events: pool.events }),
    getDuplicateCandidates: async () => ({ candidates: [] }),
    attachEmergencyToEvent: () =>
      new Promise<void>((resolve) => {
        pool.finishAttach = resolve
      }),
  },
}))

import { AlarmInboxSheet } from './alarm-inbox-sheet'
import { AlarmInboxButton } from './alarm-inbox-button'
import { openAlarmInbox, resetAlarmInboxForTests } from './alarm-inbox-store'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const alarm = (id: string, title: string, overrides: Partial<ApiDiveraEmergency> = {}): ApiDiveraEmergency => ({
  id,
  source: 'elz',
  source_id: null,
  divera_id: null,
  divera_number: null,
  title,
  text: null,
  address: null,
  latitude: null,
  longitude: null,
  received_at: minutesAgo(5),
  attached_to_event_id: null,
  attached_at: null,
  created_incident_id: null,
  is_archived: false,
  ...overrides,
})

const renderInbox = () =>
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <AlarmInboxButton />
      <AlarmInboxSheet />
    </NextIntlClientProvider>,
  )

beforeEach(() => {
  auth.current = { user: { role: 'editor' }, isAuthenticated: true, isEditor: true, isViewer: false }
  pool.fail = false
  pool.events = [{ id: 'ev', name: 'Unwetter Oberwil', training_flag: false }]
  pool.finishAttach = null
  pool.emergencies = [
    alarm('a1', 'Wasser im Keller', { address: 'Allschwilerstrasse 30, 4104 Oberwil' }),
    alarm('a2', 'Baum auf Strasse'),
    alarm('a3', 'Ziegel auf Gehweg', {
      attached_to_event_id: 'ev',
      attached_at: minutesAgo(3),
      created_incident_id: 'inc-6',
    }),
    alarm('a4', 'BMA Alarm Schulhaus', { received_at: minutesAgo(60 * 24 * 17) }),
  ]
})
afterEach(() => resetAlarmInboxForTests())

describe('AlarmInboxSheet', () => {
  it('groups the pool, names the Einsatz an alarm became and folds «Früher»', async () => {
    const user = userEvent.setup()
    renderInbox()
    // the header icon counts the new ones
    expect(await screen.findByRole('button', { name: 'Alarmeingang – 2 neue Alarme' })).toBeInTheDocument()

    act(() => openAlarmInbox())
    const sheet = await screen.findByRole('dialog', { name: 'Alarmeingang' })
    const fresh = await within(sheet).findByRole('region', { name: 'Neu · 2' })
    expect(within(fresh).getAllByRole('button', { name: /^«.+» anhängen$/ })).toHaveLength(2)
    expect(within(fresh).getByRole('button', { name: 'Alle anhängen' })).toBeInTheDocument()

    const today = within(sheet).getByRole('region', { name: 'Heute zugewiesen · 1' })
    expect(within(today).getByText('Ziegel auf Gehweg')).toBeInTheDocument()
    expect(within(today).getByText('6')).toBeInTheDocument()

    const earlier = within(sheet).getByRole('button', { name: /Früher · 1/ })
    expect(earlier).toHaveAttribute('aria-expanded', 'false')
    expect(within(sheet).queryByText('BMA Alarm Schulhaus')).toBeNull()
    await user.click(earlier)
    expect(within(sheet).getByText('BMA Alarm Schulhaus')).toBeInTheDocument()
  })

  it('«Anhängen» on a row asks for ONE alarm, onto the Ereignis this window shows', async () => {
    const user = userEvent.setup()
    renderInbox()
    act(() => openAlarmInbox())
    await user.click(await screen.findByRole('button', { name: '«Wasser im Keller» anhängen' }))
    const dialog = await screen.findByRole('dialog', { name: 'An Ereignis anhängen' })
    expect(within(dialog).getByText('1 Notfall wird dem gewählten Ereignis zugewiesen.')).toBeInTheDocument()
    expect(await within(dialog).findByText('Unwetter Oberwil')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Anhängen' })).toBeEnabled()
    // the select is named by its label and the chosen Ereignis
    expect(within(dialog).getByRole('combobox', { name: 'Ereignis Unwetter Oberwil' })).toBeInTheDocument()
    // the sheet behind stays open
    expect(screen.getByTestId('alarm-inbox')).toBeInTheDocument()
  })

  it('stays open while the attach runs – Esc does nothing, both buttons wait', async () => {
    const user = userEvent.setup()
    renderInbox()
    act(() => openAlarmInbox())
    await user.click(await screen.findByRole('button', { name: '«Wasser im Keller» anhängen' }))
    const dialog = await screen.findByRole('dialog', { name: 'An Ereignis anhängen' })
    await within(dialog).findByText('Unwetter Oberwil')
    await user.click(within(dialog).getByRole('button', { name: 'Anhängen' }))
    expect(within(dialog).getByRole('button', { name: 'Anhängen' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'An Ereignis anhängen' })).toBeInTheDocument()
    await act(async () => pool.finishAttach?.())
    expect(screen.queryByRole('dialog', { name: 'An Ereignis anhängen' })).toBeNull()
  })

  it('says why nothing can be chosen when no Ereignis is open', async () => {
    pool.events = []
    const user = userEvent.setup()
    renderInbox()
    act(() => openAlarmInbox())
    await user.click(await screen.findByRole('button', { name: '«Wasser im Keller» anhängen' }))
    const dialog = await screen.findByRole('dialog', { name: 'An Ereignis anhängen' })
    expect(await within(dialog).findByText('Kein offenes Ereignis – zuerst eines eröffnen.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Anhängen' })).toBeDisabled()
  })

  it('a first load that fails says so and offers «Erneut laden»', async () => {
    pool.fail = true
    const user = userEvent.setup()
    renderInbox()
    act(() => openAlarmInbox())
    const sheet = await screen.findByRole('dialog', { name: 'Alarmeingang' })
    expect(await within(sheet).findByText('Alarme nicht geladen')).toBeInTheDocument()
    pool.fail = false
    await user.click(within(sheet).getByRole('button', { name: 'Erneut laden' }))
    expect(await within(sheet).findByRole('region', { name: 'Neu · 2' })).toBeInTheDocument()
  })

  it('opens nothing for a viewer', async () => {
    auth.current = { user: { role: 'viewer' }, isAuthenticated: true, isEditor: false, isViewer: true }
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <AlarmInboxSheet />
      </NextIntlClientProvider>,
    )
    act(() => openAlarmInbox())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/**
 * The pool's fetch: a reload asked for during a failing fetch still runs, and an alarm still
 * waiting beyond the first page is in the pool.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import type { ApiDiveraEmergency } from '@/lib/api-client'

const api = vi.hoisted(() => ({ getDiveraEmergencies: vi.fn() }))
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: api,
}))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: () => () => {},
    onStatusChange: () => () => {},
    getStatus: () => 'connected',
  },
}))

import { reloadAlarmPool, resetAlarmInboxForTests, useAlarmPool } from './alarm-inbox-store'

const row = (id: string, receivedAt: string, overrides: Partial<ApiDiveraEmergency> = {}): ApiDiveraEmergency => ({
  id,
  source: 'elz',
  source_id: null,
  divera_id: null,
  divera_number: null,
  title: id,
  text: null,
  address: null,
  latitude: null,
  longitude: null,
  received_at: receivedAt,
  attached_to_event_id: null,
  attached_at: null,
  created_incident_id: null,
  is_archived: false,
  ...overrides,
})
const answer = (emergencies: ApiDiveraEmergency[], total = emergencies.length) => ({
  emergencies,
  total,
  unattached_count: 0,
})

afterEach(() => {
  resetAlarmInboxForTests()
  api.getDiveraEmergencies.mockReset()
})

describe('reloadAlarmPool', () => {
  it('runs the reload asked for while a fetch was failing', async () => {
    let fail: (error: Error) => void = () => {}
    api.getDiveraEmergencies
      .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue(answer([row('a', '2026-11-08T19:00:00Z')]))
    const first = reloadAlarmPool()
    void reloadAlarmPool() // folded into the running one
    fail(new Error('Verbindung zum Server unterbrochen'))
    await first
    await vi.waitFor(() => expect(api.getDiveraEmergencies.mock.calls.length).toBeGreaterThan(2))
  })

  it('keeps an alarm still waiting beyond the first page, newest first', async () => {
    const page = [row('attached', '2026-11-08T19:00:00Z', { attached_to_event_id: 'ev' })]
    const waiting = [row('waiting', '2026-11-08T08:00:00Z'), row('newer', '2026-11-08T19:10:00Z')]
    api.getDiveraEmergencies.mockImplementation(async (params: { attached?: boolean }) =>
      params.attached === false ? answer(waiting) : answer([waiting[1], ...page], 240),
    )
    const { result } = renderHook(() => useAlarmPool())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.emergencies.map((e) => e.id)).toEqual(['newer', 'attached', 'waiting'])
    expect(result.current.total).toBe(240)
  })
})

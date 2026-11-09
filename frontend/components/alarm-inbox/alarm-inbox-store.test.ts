/**
 * The pool's fetch: a reload asked for during a failing fetch still runs, an answer a newer
 * reload superseded is never shown, and an alarm still waiting beyond the first page is in the pool.
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

  it('never shows an answer a newer reload already superseded', async () => {
    const fresh = row('x', '2026-11-08T19:00:00Z')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let phase: 'initial' | 'stale' | 'current' = 'initial'
    api.getDiveraEmergencies.mockImplementation(async () => {
      if (phase === 'initial') return answer([])
      if (phase === 'stale') {
        await gate
        return answer([fresh]) // read just before somebody attached it
      }
      return answer([{ ...fresh, attached_to_event_id: 'ev' }])
    })
    // Every pool the inbox renders, as «id:attached?».
    const shown: string[][] = []
    const { result } = renderHook(() => {
      const current = useAlarmPool()
      shown.push(current.emergencies.map((e) => `${e.id}:${e.attached_to_event_id ? 'attached' : 'neu'}`))
      return current
    })
    await waitFor(() => expect(result.current.loaded).toBe(true))

    phase = 'stale'
    const running = reloadAlarmPool()
    void reloadAlarmPool() // the attach's socket event, while the first fetch is out
    phase = 'current'
    release()
    await running
    await waitFor(() => expect(result.current.emergencies).toHaveLength(1))
    expect(result.current.emergencies[0].attached_to_event_id).toBe('ev')
    expect(shown.flat()).not.toContain('x:neu')
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

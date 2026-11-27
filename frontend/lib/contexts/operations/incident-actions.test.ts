import { describe, expect, it, vi } from 'vitest'
import type { SetStateAction } from 'react'
import type { ApiIncident } from '@/lib/api-client'
import type { BoardMutationContext } from './board-context'
import type { NewOperation, Operation } from './types'

const api = vi.hoisted(() => ({ createIncident: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: api, ApiError: class extends Error {} }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { createIncidentActions } from './incident-actions'

const EVENT_A = '11111111-1111-4111-8111-111111111111'
const EVENT_B = '22222222-2222-4222-8222-222222222222'

const created = {
  id: 'inc-1',
  event_id: EVENT_A,
  title: 'Hauptstrasse 1',
  location_address: 'Hauptstrasse 1',
  type: 'elementarereignis',
  priority: 'high',
  status: 'incoming',
  created_at: '2026-11-25T20:00:00Z',
} as ApiIncident

/** The incident actions of a board showing Ereignis A, with `setOperations` writing to `state`. */
function boardOnEventA() {
  const state = { operations: [] as Operation[] }
  const context = {
    operations: state.operations,
    selectedEvent: { id: EVENT_A },
    selectedEventIdRef: { current: EVENT_A },
    mutationEpochRef: { current: 0 },
    setOperations: (next: SetStateAction<Operation[]>) => {
      state.operations = typeof next === 'function' ? next(state.operations) : next
    },
  }
  return { state, context, actions: createIncidentActions(context as unknown as BoardMutationContext) }
}

const report = { location: 'Hauptstrasse 1', incidentType: 'elementarereignis', priority: 'high' } as NewOperation

describe('createOperation', () => {
  it('drops the answer when the board switched Ereignis while the POST was out', async () => {
    let answer: (incident: ApiIncident) => void = () => {}
    api.createIncident.mockReturnValueOnce(new Promise<ApiIncident>((resolve) => { answer = resolve }))
    const { state, context, actions } = boardOnEventA()

    const creating = actions.createOperation(report)
    context.selectedEventIdRef.current = EVENT_B
    answer(created)

    await expect(creating).resolves.toBe(true)
    expect(state.operations).toEqual([])
    expect(context.mutationEpochRef.current).toBe(0)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetStateAction } from 'react'
import type { Person } from '../personnel-context'
import type { BoardMutationContext } from './board-context'
import type { Operation } from './types'

const api = vi.hoisted(() => ({ assignRekoPersonnel: vi.fn(), unassignRekoPersonnel: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

import { createResourceActions } from './resource-actions'

const sina = { id: 'p-sina', name: 'Unternährer Sina', isReko: true } as Person

/** The actions over one incident, with `setOperations` writing to `state.operations`. */
function board(op: Partial<Operation>) {
  const state = { operations: [{ id: 'op-14', status: 'reko', assignedReko: null, ...op } as Operation] }
  const context = {
    operations: state.operations,
    personnel: [sina],
    isLoaded: true,
    setOperations: (next: SetStateAction<Operation[]>) => {
      state.operations = typeof next === 'function' ? next(state.operations) : next
    },
    armAssignmentCooldown: vi.fn(),
    releaseAssignmentCooldown: vi.fn(),
  } as unknown as BoardMutationContext
  return { state, actions: createResourceActions(context) }
}

describe('Reko assign and release', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the row id the assign POST answers, so the tick can release that row', async () => {
    api.assignRekoPersonnel.mockResolvedValue({ id: 'a-1', purpose: 'reko' })
    const { state, actions } = board({})

    await actions.assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')

    expect(state.operations[0].assignedReko).toEqual({ id: 'p-sina', name: 'Unternährer Sina', assignmentId: 'a-1', purpose: 'reko' })
  })

  it('sends no release while the row id is unknown (the assign POST may still be refused)', () => {
    const { state, actions } = board({ assignedReko: { id: 'p-sina', name: 'Unternährer Sina' } })

    actions.removeReko('op-14')

    expect(api.unassignRekoPersonnel).not.toHaveBeenCalled()
    expect(state.operations[0].assignedReko).not.toBeNull()
  })

  it('releases exactly the known row', () => {
    api.unassignRekoPersonnel.mockResolvedValue(undefined)
    const { actions } = board({ assignedReko: { id: 'p-sina', name: 'Unternährer Sina', assignmentId: 'a-1' } })

    actions.removeReko('op-14')

    expect(api.unassignRekoPersonnel).toHaveBeenCalledWith('op-14', 'p-sina', 'a-1')
  })
})

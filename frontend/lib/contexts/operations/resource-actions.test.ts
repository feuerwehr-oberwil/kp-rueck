import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetStateAction } from 'react'
import type { Person } from '../personnel-context'
import type { BoardMutationContext } from './board-context'
import type { Operation } from './types'

const api = vi.hoisted(() => ({ assignRekoPersonnel: vi.fn(), unassignRekoPersonnel: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

import { createResourceActions } from './resource-actions'
import { makeOperation } from '@/test-utils/operation-fixtures'

const sina = { id: 'p-sina', name: 'Unternährer Sina', isReko: true } as Person
const bea = { id: 'p-bea', name: 'Brunner Bea', isReko: true } as Person

/** The actions over one incident, with `setOperations` writing to `state.operations`.
 *  `fresh()` builds them over the current state, as the provider does on every render. */
function board(op: Partial<Operation>) {
  const state = { operations: [makeOperation({ id: 'op-14', status: 'reko', assignedReko: null, ...op })] }
  const settled = vi.fn()
  const context = {
    personnel: [sina, bea],
    isLoaded: true,
    setOperations: (next: SetStateAction<Operation[]>) => {
      state.operations = typeof next === 'function' ? next(state.operations) : next
    },
    refreshOperations: vi.fn(async () => true),
    armAssignmentCooldown: vi.fn(),
    releaseAssignmentCooldown: vi.fn(),
    beginAssignmentSettling: vi.fn(() => settled),
  }
  const fresh = () => createResourceActions({ ...context, operations: state.operations } as unknown as BoardMutationContext)
  return { state, actions: fresh(), fresh, context, settled }
}

/** A POST answer the test hands out when it chooses. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Reko assign and release', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the row id the assign POST answers, so the tick can release that row', async () => {
    api.assignRekoPersonnel.mockResolvedValue({ id: 'a-1', purpose: 'reko' })
    const { state, actions } = board({})

    await actions.assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')

    expect(state.operations[0].assignedReko).toEqual({ id: 'p-sina', name: 'Unternährer Sina', assignmentId: 'a-1', purpose: 'reko' })
  })

  it('settles until the POST answers, so ⌘K reports (and offers its undo) with the row id', async () => {
    const post = deferred<{ id: string; purpose: 'reko' }>()
    api.assignRekoPersonnel.mockReturnValue(post.promise)
    const { state, actions, context, settled } = board({})

    const assigning = actions.assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')
    expect(context.beginAssignmentSettling).toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    post.resolve({ id: 'a-1', purpose: 'reko' })
    await assigning
    expect(settled).toHaveBeenCalled()
    expect(state.operations[0].assignedReko?.assignmentId).toBe('a-1')
  })

  it('applies each answer only to the entry its own request made (A, B, back to A)', async () => {
    const posts = [deferred<{ id: string }>(), deferred<{ id: string }>(), deferred<{ id: string }>()]
    posts.forEach((post) => api.assignRekoPersonnel.mockReturnValueOnce(post.promise))
    const { state, fresh } = board({})

    const first = fresh().assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')
    const second = fresh().assignRekoPersonToOperation('p-bea', 'Brunner Bea', 'op-14')
    const third = fresh().assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')
    posts[1].resolve({ id: 'b-2' })
    posts[2].resolve({ id: 'a-3' })
    await Promise.all([second, third])
    // The first A answers last: its row was released by the switch to B.
    posts[0].resolve({ id: 'a-1' })
    await first

    expect(state.operations[0].assignedReko).toMatchObject({ id: 'p-sina', assignmentId: 'a-3' })
  })

  it('reverts only its own entry when its POST fails after a later assign', async () => {
    const posts = [deferred<{ id: string }>(), deferred<{ id: string }>()]
    api.assignRekoPersonnel.mockReturnValueOnce(posts[0].promise.then(() => Promise.reject(new Error('refused'))))
    api.assignRekoPersonnel.mockReturnValueOnce(posts[1].promise)
    const { state, fresh } = board({})

    const first = fresh().assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')
    const second = fresh().assignRekoPersonToOperation('p-bea', 'Brunner Bea', 'op-14')
    posts[1].resolve({ id: 'b-2' })
    await second
    posts[0].resolve({ id: 'unused' })
    await first

    expect(state.operations[0].assignedReko).toMatchObject({ id: 'p-bea', assignmentId: 'b-2' })
  })

  it('a refused replacement leaves the card with the Reko it had, not with none', async () => {
    api.assignRekoPersonnel.mockRejectedValue(new Error('502'))
    const before = { id: 'p-bea', name: 'Brunner Bea', assignmentId: 'b-1', purpose: 'reko' as const }
    const { state, actions } = board({ assignedReko: before })

    await actions.assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')

    expect(state.operations[0].assignedReko).toEqual(before)
  })

  it('reloads when the Reko it would go back to was itself still pending', async () => {
    const posts = [deferred<{ id: string }>(), deferred<{ id: string }>()]
    posts.forEach((post) => api.assignRekoPersonnel.mockReturnValueOnce(post.promise.then(() => Promise.reject(new Error('502')))))
    const { fresh, context } = board({ assignedReko: { id: 'p-bea', name: 'Brunner Bea', assignmentId: 'b-1', purpose: 'reko' } })

    const toSina = fresh().assignRekoPersonToOperation('p-sina', 'Unternährer Sina', 'op-14')
    const backToBea = fresh().assignRekoPersonToOperation('p-bea', 'Brunner Bea', 'op-14')
    posts[0].resolve({ id: 'unused' })
    await toSina
    expect(context.refreshOperations).not.toHaveBeenCalled()
    posts[1].resolve({ id: 'unused' })
    await backToBea

    // The card would show Sina without a row id – unreleasable, and not what the server holds.
    expect(context.refreshOperations).toHaveBeenCalledTimes(1)
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

  it('releases nothing when the card shows another row than the expected one (⌘K undo)', () => {
    const { actions } = board({ assignedReko: { id: 'p-sina', name: 'Unternährer Sina', assignmentId: 'a-3' } })

    actions.removeReko('op-14', 'a-1')

    expect(api.unassignRekoPersonnel).not.toHaveBeenCalled()
  })
})

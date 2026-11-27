import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { toast } from 'sonner'
import de from '@/messages/de.json'
import { useBoardCardActions } from './use-board-card-actions'
import type { Operation } from '@/lib/contexts/operations-context'
import type { IncidentStatusWorkflowController } from '@/components/kanban/incident-status/use-incident-status-workflow'
import { makeOperation } from '@/test-utils/operation-fixtures'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// The board contexts the hook reads – one mutable board per test.
const board = vi.hoisted(() => ({
  operations: [] as Operation[],
  requestResourceConflict: vi.fn(),
  assignResource: vi.fn(),
}))
vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({ operations: board.operations, requestResourceConflict: board.requestResourceConflict }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({
  useGroups: () => ({
    groups: [{ id: 'g-1', name: 'Nord', assignments: [] }],
    assignResource: board.assignResource,
  }),
}))
vi.mock('@/lib/hooks/use-release-undo', () => ({ useReleaseUndo: () => ({}) }))
vi.mock('@/lib/contexts/operations/use-vehicle-shortcuts', () => ({
  useVehicleShortcuts: () => [{ key: 'tlf', id: 'v-tlf', name: 'TLF', type: 'tlf', status: 'available' }],
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
    {children}
  </NextIntlClientProvider>
)

const op = (id: string, extra: Partial<Operation> = {}) =>
  makeOperation({ id, location: `Strasse ${id}`, vehicles: [], crew: [], materials: [], groupId: null, ...extra })

function setup(operations: Operation[]) {
  board.operations = operations
  board.assignResource.mockResolvedValue(true)
  const { result } = renderHook(() => useBoardCardActions({} as IncidentStatusWorkflowController), { wrapper })
  return { toggle: result.current.toggleVehicleAssignment }
}

describe('number keys on an Auftrag stop (Sol review S3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asks the #22 question for a vehicle another Einsatz holds instead of double-booking it', () => {
    const holder = op('op-2', { vehicles: [{ vehicleId: 'v-tlf', assignmentId: 'a-1', name: 'TLF', callsign: null }] } as Partial<Operation>)
    const { toggle } = setup([op('op-1', { groupId: 'g-1' }), holder])

    toggle(op('op-1', { groupId: 'g-1' }), { id: 'v-tlf', name: 'TLF' })

    expect(board.assignResource).not.toHaveBeenCalled()
    expect(board.requestResourceConflict).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'v-tlf', targetOperationId: 'g-1' }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('assigns a free vehicle to the Auftrag and toasts only once that went through', async () => {
    const { toggle } = setup([op('op-1', { groupId: 'g-1' })])
    board.assignResource.mockResolvedValueOnce(false)

    toggle(op('op-1', { groupId: 'g-1' }), { id: 'v-tlf', name: 'TLF' })
    await waitFor(() => expect(board.assignResource).toHaveBeenCalledWith('g-1', 'vehicle', 'v-tlf'))
    await Promise.resolve()
    expect(toast.success).not.toHaveBeenCalled()

    toggle(op('op-1', { groupId: 'g-1' }), { id: 'v-tlf', name: 'TLF' })
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
  })
})

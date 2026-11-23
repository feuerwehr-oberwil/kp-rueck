import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const board = vi.hoisted(() => ({
  resourceConflict: null as unknown,
  resolveResourceConflict: vi.fn(),
  cancelResourceConflict: vi.fn(),
  operations: [] as unknown[],
  personnel: [] as unknown[],
}))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => board }))

import { ResourceConflictPrompt } from '@/components/resource-conflict-prompt'

function ask(resourceType: 'vehicle' | 'personnel' | 'material', resourceName = 'TLF') {
  board.resolveResourceConflict.mockClear()
  board.cancelResourceConflict.mockClear()
  board.resourceConflict = {
    resourceType,
    resourceId: 'r-1',
    resourceName,
    targetOperationId: 'op-2',
    targetOperationLabel: '13 · Rebgasse 8',
    conflicts: [{ operationId: 'op-1', operationLabel: '11 · Bahnhofstrasse 12' }],
  }
  renderWithIntl(<ResourceConflictPrompt />)
}

// Owner pick #3 (23.11.2026): «cancel is default. move or auf beiden needs to be clearly
// described and manually selected» – for every resource type.
describe('ResourceConflictPrompt', () => {
  it.each(['vehicle', 'personnel', 'material'] as const)('Enter on a %s changes nothing', async (type) => {
    ask(type)
    expect(screen.getByRole('button', { name: /Abbrechen/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(board.resolveResourceConflict).not.toHaveBeenCalled()
    expect(board.cancelResourceConflict).toHaveBeenCalledOnce()
  })

  it('runs a card on its letter: V moves, B keeps', async () => {
    ask('personnel', 'Pio')
    await userEvent.keyboard('v')
    expect(board.resolveResourceConflict).toHaveBeenLastCalledWith('move')
    await userEvent.keyboard('B')
    expect(board.resolveResourceConflict).toHaveBeenLastCalledWith('keep')
  })

  it('runs a card on one click and says what each answer leaves behind', async () => {
    ask('vehicle')
    const move = screen.getByRole('button', { name: 'Hierher verschieben' })
    expect(move).toHaveAccessibleDescription('TLF verlässt 11 · Bahnhofstrasse 12 und ist danach nur noch auf 13 · Rebgasse 8.')
    expect(screen.getByRole('button', { name: 'Auf beiden führen' })).toHaveAccessibleDescription(
      'TLF bleibt auf 11 · Bahnhofstrasse 12 und wird zusätzlich 13 · Rebgasse 8 zugewiesen. Beide Karten zeigen 2×.',
    )
    await userEvent.click(move)
    expect(board.resolveResourceConflict).toHaveBeenCalledWith('move')
  })

  it('says that moving a Fahrer gives up the driver role', () => {
    board.personnel = [{ id: 'r-1', isDriver: true, driverVehicleId: 'v-tlf', driverVehicleName: 'TLF' }]
    board.operations = [{ id: 'op-1', number: 11, location: 'Bahnhofstrasse 12', vehicles: [{ vehicleId: 'v-tlf' }], crew: [] }]
    ask('personnel', 'Müller Hans')
    expect(screen.getByRole('button', { name: 'Hierher verschieben' })).toHaveAccessibleDescription(
      'Müller Hans verlässt 11 · Bahnhofstrasse 12, gibt die Fahrer-Rolle für TLF ab und ist danach nur noch auf 13 · Rebgasse 8.',
    )
    board.personnel = []
    board.operations = []
  })
})

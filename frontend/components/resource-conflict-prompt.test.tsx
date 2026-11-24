import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
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

  it('keeps every key from the board and the picker underneath', async () => {
    // Stands in for the board («0» = Zu Fuss) and an open picker («1»–«9»): both listen on window.
    const underneath = vi.fn()
    window.addEventListener('keydown', underneath)
    try {
      ask('vehicle')
      await userEvent.keyboard('01')
      // Tab still walks the cards, Radix still hears Esc, the card's letter still runs it.
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'Hierher verschieben' })).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(board.cancelResourceConflict).toHaveBeenCalledOnce()
      await userEvent.keyboard('v')
      expect(board.resolveResourceConflict).toHaveBeenCalledWith('move')
      expect(underneath).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', underneath)
    }
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

  // Sol review E, S5: one Modul drop, the Säge on Auftrag Süd, the Pumpe on Einsatz 11.
  it('draws on each holder only what stands there, each with its own count', () => {
    board.resourceConflict = {
      resourceType: 'material',
      resourceId: 'm-1',
      resourceName: 'Säge, Pumpe',
      resourceCount: 2,
      targetOperationId: 'op-2',
      targetOperationLabel: '13 · Rebgasse 8',
      conflicts: [
        { operationId: 'g-2', operationLabel: 'Süd', held: [{ id: 'm-1', name: 'Säge' }] },
        { operationId: 'op-1', operationLabel: '11 · Bahnhofstrasse 12', held: [{ id: 'm-2', name: 'Pumpe' }] },
      ],
    }
    renderWithIntl(<ResourceConflictPrompt />)
    const keep = screen.getByRole('button', { name: 'Auf beiden führen' })
    // Each device is on two cards, not on all three.
    expect(within(keep).getAllByText('Säge · 2×')).toHaveLength(2)
    expect(within(keep).getAllByText('Pumpe · 2×')).toHaveLength(2)
    expect(within(keep).queryByText(/3×/)).toBeNull()
    // No «Alle 3 Karten zeigen 3×» when that is not true.
    expect(keep).toHaveAccessibleDescription(
      'Säge, Pumpe bleiben auf Süd, 11 · Bahnhofstrasse 12 und werden zusätzlich 13 · Rebgasse 8 zugewiesen.',
    )
    const move = screen.getByRole('button', { name: 'Hierher verschieben' })
    expect(within(move).getAllByText('Säge')).toHaveLength(2)
    expect(within(move).getAllByText('Pumpe')).toHaveLength(2)
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

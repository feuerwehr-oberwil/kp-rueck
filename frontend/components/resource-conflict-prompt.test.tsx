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
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ groups: [{ id: 'g-1', name: 'Route West' }] }) }))
const queue = vi.hoisted(() => ({ plans: [] as { incident_group_id: string | null; incident_id: string | null }[] }))
vi.mock('@/lib/contexts/planned-context', () => ({ usePlanned: () => ({ queueOf: () => queue.plans }) }))

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
// described and manually selected» – for every resource type. Owner pick 2B (24.11.2026):
// never on two – «Danach vormerken» takes the place of «Auf beiden führen».
describe('ResourceConflictPrompt', () => {
  it.each(['vehicle', 'personnel', 'material'] as const)('Enter on a %s changes nothing', async (type) => {
    ask(type)
    expect(screen.getByRole('button', { name: /Abbrechen/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(board.resolveResourceConflict).not.toHaveBeenCalled()
    expect(board.cancelResourceConflict).toHaveBeenCalledOnce()
  })

  it('runs a card on its letter: V moves, D plans', async () => {
    ask('personnel', 'Pio')
    expect(screen.queryByRole('button', { name: /beiden/ })).toBeNull()
    await userEvent.keyboard('v')
    expect(board.resolveResourceConflict).toHaveBeenLastCalledWith('move')
    await userEvent.keyboard('D')
    expect(board.resolveResourceConflict).toHaveBeenLastCalledWith('plan')
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
      expect(screen.getByRole('button', { name: 'Jetzt verschieben' })).toHaveFocus()
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
    const move = screen.getByRole('button', { name: 'Jetzt verschieben' })
    expect(move).toHaveAccessibleDescription('TLF verlässt 11 · Bahnhofstrasse 12 und ist danach nur noch auf 13 · Rebgasse 8.')
    expect(screen.getByRole('button', { name: 'Danach vormerken' })).toHaveAccessibleDescription(
      'TLF bleibt auf 11 · Bahnhofstrasse 12 und steht auf 13 · Rebgasse 8 als Danach. Sobald frei, erscheint «Zuteilen» – nichts bewegt sich von selbst.',
    )
    await userEvent.click(move)
    expect(board.resolveResourceConflict).toHaveBeenCalledWith('move')
  })

  // Sol review E, S5: one Modul drop, the Säge on Auftrag Süd, the Pumpe on Einsatz 11.
  it('draws on each holder only what stands there', () => {
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
    const plan = screen.getByRole('button', { name: 'Danach vormerken' })
    // Each device stays on its own holder and stands on the target as Danach.
    expect(within(plan).getAllByText('Säge')).toHaveLength(1)
    expect(within(plan).getAllByText('Pumpe')).toHaveLength(1)
    expect(within(plan).getByText('Säge · Danach')).toBeInTheDocument()
    expect(within(plan).getByText('Pumpe · Danach')).toBeInTheDocument()
    const move = screen.getByRole('button', { name: 'Jetzt verschieben' })
    expect(within(move).getAllByText('Säge')).toHaveLength(2)
    expect(within(move).getAllByText('Pumpe')).toHaveLength(2)
  })

  it('says that moving a Fahrer gives up the driver role', () => {
    board.personnel = [{ id: 'r-1', isDriver: true, driverVehicleId: 'v-tlf', driverVehicleName: 'TLF' }]
    board.operations = [{ id: 'op-1', number: 11, location: 'Bahnhofstrasse 12', vehicles: [{ vehicleId: 'v-tlf' }], crew: [] }]
    ask('personnel', 'Müller Hans')
    expect(screen.getByRole('button', { name: 'Jetzt verschieben' })).toHaveAccessibleDescription(
      'Müller Hans verlässt 11 · Bahnhofstrasse 12, gibt die Fahrer-Rolle für TLF ab und ist danach nur noch auf 13 · Rebgasse 8.',
    )
    board.personnel = []
    board.operations = []
  })

  it('names the Danach it already has – a new one queues behind', () => {
    queue.plans = [{ incident_id: null, incident_group_id: 'g-1' }]
    ask('personnel')
    expect(screen.getByRole('button', { name: 'Danach vormerken' })).toHaveAccessibleDescription(
      expect.stringContaining('Schon Danach für: Route West. Das hier kommt dahinter.'),
    )
    queue.plans = []
  })
})

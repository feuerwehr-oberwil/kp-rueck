import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const board = vi.hoisted(() => ({
  resourceConflict: null as unknown,
  resolveResourceConflict: vi.fn(),
  cancelResourceConflict: vi.fn(),
  operations: [],
  personnel: [],
}))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => board }))

import { ResourceConflictPrompt } from '@/components/resource-conflict-prompt'

function ask(resourceType: 'vehicle' | 'personnel' | 'material') {
  board.resolveResourceConflict.mockClear()
  board.resourceConflict = {
    resourceType,
    resourceId: 'r-1',
    resourceName: 'TLF',
    targetOperationId: 'op-2',
    targetOperationLabel: 'Rebgasse 8',
    conflicts: [{ operationId: 'op-1', operationLabel: 'Bahnhofstrasse 12' }],
  }
  renderWithIntl(<ResourceConflictPrompt />)
}

// Owner pick #22: a vehicle may serve two Einsätze; a person or a pump cannot be in two places.
describe('ResourceConflictPrompt main answer', () => {
  it('keeps a vehicle on both on Enter', async () => {
    ask('vehicle')
    expect(screen.getByRole('button', { name: 'Auf beiden führen' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(board.resolveResourceConflict).toHaveBeenCalledWith('keep')
  })

  it.each(['personnel', 'material'] as const)('moves %s here on Enter', async (type) => {
    ask(type)
    expect(screen.getByRole('button', { name: 'Hierher verschieben' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(board.resolveResourceConflict).toHaveBeenCalledWith('move')
  })
})

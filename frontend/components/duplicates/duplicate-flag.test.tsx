import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'

/**
 * «Mögliches Duplikat von …» on a card an automatic door made (R2): the flag
 * names the other card, and its two buttons are the whole decision.
 */

const ops = vi.hoisted(() => ({
  mergeExistingOperation: vi.fn(async () => true),
  refreshOperations: vi.fn(async () => {}),
  operations: [{ id: 'target', location: 'Mühleweg 12, 4104 Oberwil', locationDisplay: 'Mühleweg 12', incidentType: 'elementarereignis' }],
}))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ops }))
const api = vi.hoisted(() => ({ dismissDuplicate: vi.fn(async () => ({})) }))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { DuplicateFlag } from './duplicate-flag'

beforeEach(() => vi.clearAllMocks())

describe('DuplicateFlag', () => {
  it('names the card and merges into it with one click', async () => {
    const user = userEvent.setup()
    renderWithIntl(<DuplicateFlag operationId="dup" targetId="target" />)
    expect(screen.getByTestId('duplicate-flag')).toHaveTextContent('Mögliches Duplikat von Mühleweg 12')
    await user.click(screen.getByRole('button', { name: /Zusammenführen/ }))
    expect(ops.mergeExistingOperation).toHaveBeenCalledWith('dup', 'target')
  })

  it('«Kein Duplikat» clears the flag and keeps the card', async () => {
    const user = userEvent.setup()
    renderWithIntl(<DuplicateFlag operationId="dup" targetId="target" />)
    await user.click(screen.getByRole('button', { name: 'Kein Duplikat' }))
    expect(api.dismissDuplicate).toHaveBeenCalledWith('dup')
    expect(ops.refreshOperations).toHaveBeenCalled()
    expect(ops.mergeExistingOperation).not.toHaveBeenCalled()
  })

  it('asks first when the card has work on it, and names what moves', async () => {
    const user = userEvent.setup()
    ops.operations.push({
      id: 'busy',
      location: 'Hauptstr. 6',
      incidentType: 'elementarereignis',
      status: 'active',
      crew: ['Meier Hans'],
      vehicles: ['TLF 1'],
      vehicle: null,
      materials: [],
      hasCompletedReko: true,
      fieldRequests: [],
    } as never)
    renderWithIntl(<DuplicateFlag operationId="busy" targetId="target" />)
    await user.click(screen.getByRole('button', { name: /Zusammenführen/ }))
    expect(ops.mergeExistingOperation).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Mannschaft, Fahrzeuge, Reko-Bericht')
    await user.click(within(dialog).getByRole('button', { name: /Zusammenführen/ }))
    expect(ops.mergeExistingOperation).toHaveBeenCalledWith('busy', 'target')
  })

  it('offers no merge away from a closed card', () => {
    ops.operations.push({ id: 'done', location: 'X', incidentType: 'elementarereignis', status: 'complete', crew: [], vehicles: [], materials: [] } as never)
    renderWithIntl(<DuplicateFlag operationId="done" targetId="target" />)
    expect(screen.queryByRole('button', { name: /Zusammenführen/ })).toBeNull()
  })

  it('offers no merge into a closed card', () => {
    ops.operations.push({ id: 'closed', location: 'Bahnhofstrasse 3', locationDisplay: 'Bahnhofstrasse 3', incidentType: 'elementarereignis', status: 'complete' } as never)
    renderWithIntl(<DuplicateFlag operationId="dup" targetId="closed" />)
    expect(screen.queryByRole('button', { name: /Zusammenführen/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Kein Duplikat' })).toBeInTheDocument()
  })

  it('offers no merge into a card that is gone, and no buttons at all read-only', () => {
    const { rerender } = renderWithIntl(<DuplicateFlag operationId="dup" targetId="gone" />)
    expect(screen.getByTestId('duplicate-flag')).toHaveTextContent('Mögliches Duplikat')
    expect(screen.queryByRole('button', { name: /Zusammenführen/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Kein Duplikat' })).toBeInTheDocument()
    rerender(<DuplicateFlag operationId="dup" targetId="target" canEdit={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

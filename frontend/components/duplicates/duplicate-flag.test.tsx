import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
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

  it('offers no merge into a card that is gone, and no buttons at all read-only', () => {
    const { rerender } = renderWithIntl(<DuplicateFlag operationId="dup" targetId="gone" />)
    expect(screen.getByTestId('duplicate-flag')).toHaveTextContent('Mögliches Duplikat')
    expect(screen.queryByRole('button', { name: /Zusammenführen/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Kein Duplikat' })).toBeInTheDocument()
    rerender(<DuplicateFlag operationId="dup" targetId="target" canEdit={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

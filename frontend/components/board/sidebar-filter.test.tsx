import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { SidebarFilterPopover } from '@/components/board/sidebar-filter'

/**
 * The board's shortcuts listen on window. A key pressed in the popover belongs to the popover –
 * Escape included: with the «G» chord armed it used to close the popover AND cancel the chord.
 */
describe('the «Filter & Sortierung» popover', () => {
  const boardKeys = vi.fn((event: KeyboardEvent) => event.key)
  afterEach(() => window.removeEventListener('keydown', boardKeys))

  it('closes on Escape without the board seeing the key', async () => {
    const user = userEvent.setup()
    window.addEventListener('keydown', boardKeys)
    renderWithIntl(
      <SidebarFilterPopover count={0} changed={false} onReset={() => {}} side="left" footer="3 von 3 Geräten">
        <button type="button">Standort</button>
      </SidebarFilterPopover>,
    )

    await user.click(screen.getByRole('button', { name: 'Filter & Sortierung' }))
    expect(screen.getByText('3 von 3 Geräten')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Escape}')

    expect(screen.queryByText('3 von 3 Geräten')).not.toBeInTheDocument()
    expect(boardKeys).not.toHaveBeenCalled()
  })
})

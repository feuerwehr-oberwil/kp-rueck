/**
 * The board teaches its keys in the tooltip (owner pick «A», 16.11.2026): name + key caps, the
 * app's tooltip instead of a native `title` – so the control carries no `title` any more.
 */
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutTooltip } from './shortcut-tooltip'

describe('ShortcutTooltip', () => {
  it('names the control and shows its chord as caps on hover', async () => {
    render(
      <ShortcutTooltip label="Board" keys={['G', 'B']}>
        <button type="button" aria-label="Board">B</button>
      </ShortcutTooltip>,
    )
    const button = screen.getByRole('button', { name: 'Board' })
    expect(button.getAttribute('title')).toBeNull()

    await userEvent.hover(button)
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('Board')
    expect(within(tip).getByText('G').tagName).toBe('KBD')
    expect(within(tip).getByText('B').tagName).toBe('KBD')
  })

  it('is a plain name for a control without a key', async () => {
    render(
      <ShortcutTooltip label="Ansicht">
        <button type="button">Ansicht</button>
      </ShortcutTooltip>,
    )
    await userEvent.hover(screen.getByRole('button', { name: 'Ansicht' }))
    const tip = await screen.findByRole('tooltip')
    expect(tip.querySelector('kbd')).toBeNull()
  })
})

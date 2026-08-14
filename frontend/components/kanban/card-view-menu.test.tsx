import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { CardViewMenu } from '@/components/kanban/card-view-menu'
import {
  CARD_VIEW_KEYS,
  CARD_VIEW_PRESETS,
  matchCardViewPreset,
  toggleCardViewKey,
  type CardViewSettings,
} from '@/lib/card-view'

/**
 * The "Ansicht" control. A preset writes every switch; a switch afterwards
 * writes only itself — the menu must never quietly re-apply a preset over an
 * operator's deviation.
 */

function renderMenu(view: CardViewSettings) {
  const onApplyPreset = vi.fn()
  const onToggleKey = vi.fn()
  renderWithIntl(
    <CardViewMenu
      view={view}
      preset={matchCardViewPreset(view)}
      onApplyPreset={onApplyPreset}
      onToggleKey={onToggleKey}
    />,
  )
  return { onApplyPreset, onToggleKey }
}

describe('the Ansicht menu', () => {
  it('offers exactly the three presets and one switch per block', async () => {
    const user = userEvent.setup()
    renderMenu(CARD_VIEW_PRESETS.standard)
    await user.click(screen.getByRole('button', { name: /Ansicht/ }))

    expect(screen.getByRole('button', { name: 'Kompakt' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Standard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alles' })).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(CARD_VIEW_KEYS.length)
  })

  it('never offers a switch for the address, the priority or a warning', async () => {
    const user = userEvent.setup()
    renderMenu(CARD_VIEW_PRESETS.standard)
    await user.click(screen.getByRole('button', { name: /Ansicht/ }))

    for (const forbidden of ['Adresse', 'Priorität', 'Abholung', 'Rapport', 'Warnung']) {
      expect(screen.queryByRole('switch', { name: forbidden })).not.toBeInTheDocument()
    }
    expect(screen.getByText(/immer sichtbar/i)).toBeInTheDocument()
  })

  it('marks the preset the current settings match, and nothing when they are custom', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithIntl(
      <CardViewMenu
        view={CARD_VIEW_PRESETS.kompakt}
        preset="kompakt"
        onApplyPreset={vi.fn()}
        onToggleKey={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Ansicht/ }))
    expect(screen.getByRole('button', { name: 'Kompakt' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Alles' })).toHaveAttribute('aria-pressed', 'false')
    unmount()

    const custom = toggleCardViewKey(CARD_VIEW_PRESETS.standard, 'mannschaft')
    renderMenu(custom)
    await user.click(screen.getByRole('button', { name: /Ansicht/ }))
    for (const preset of ['Kompakt', 'Standard', 'Alles']) {
      expect(screen.getByRole('button', { name: preset })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('asks for a whole preset when a preset is clicked', async () => {
    const user = userEvent.setup()
    const { onApplyPreset, onToggleKey } = renderMenu(CARD_VIEW_PRESETS.standard)
    await user.click(screen.getByRole('button', { name: /Ansicht/ }))
    await user.click(screen.getByRole('button', { name: 'Kompakt' }))

    expect(onApplyPreset).toHaveBeenCalledWith('kompakt')
    expect(onToggleKey).not.toHaveBeenCalled()
  })

  it('asks for exactly one key when a switch is flipped — no preset re-apply', async () => {
    const user = userEvent.setup()
    const { onApplyPreset, onToggleKey } = renderMenu(CARD_VIEW_PRESETS.standard)
    await user.click(screen.getByRole('button', { name: /Ansicht/ }))
    await user.click(screen.getByRole('switch', { name: 'Mannschaft' }))

    expect(onToggleKey).toHaveBeenCalledTimes(1)
    expect(onToggleKey).toHaveBeenCalledWith('mannschaft')
    expect(onApplyPreset).not.toHaveBeenCalled()
  })
})

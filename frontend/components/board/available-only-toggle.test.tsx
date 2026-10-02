import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))

import { AvailableOnlyToggle } from '@/components/board/sidebar-parts'

/**
 * «Nur verfügbare» is a filter, and a filter that is ON is a choice: it uses
 * the same slate «selected» state as every other filter. Green belongs to the
 * availability dots and badges, not to a toggled control (CLAUDE.md → Colour
 * roles).
 */
describe('the «Nur verfügbare» sidebar toggle', () => {
  it('draws ON in the slate selection role, not green', () => {
    render(<AvailableOnlyToggle active onToggle={vi.fn()} label="Nur verfügbare" />)
    const toggle = screen.getByRole('button', { name: 'Nur verfügbare' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveClass('bg-sel-wash', 'text-sel-foreground', 'border-sel-edge')
    expect(toggle.className).not.toMatch(/emerald|green/)
  })

  it('stays quiet when OFF', () => {
    render(<AvailableOnlyToggle active={false} onToggle={vi.fn()} label="Nur verfügbare" />)
    const toggle = screen.getByRole('button', { name: 'Nur verfügbare' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle.className).not.toMatch(/sel-|emerald/)
  })
})

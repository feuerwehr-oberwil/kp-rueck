import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { TrainingBadge, TrainingBand } from '@/components/training-mode-chrome'

/**
 * The Übungs-Band is rendered by four surfaces (board, wall display, Karte,
 * Übungs-Steuerung), each with different siblings. In flow it pushed some of
 * them down and not others — with the Benachrichtigungen sidebar open,
 * the board header and the sidebar header no longer lined up, because that panel
 * is a flex sibling of <main> and never saw the strip.
 *
 * So the contract is: the band takes NO layout height, on every surface. That is
 * what these two assertions pin down — anything that puts it back into flow
 * (dropping `fixed`, or a caller passing a `relative`/`static` override) breaks
 * alignment again, and does so on one surface at a time, which is exactly the
 * drift that is hard to spot.
 */
describe('TrainingBand', () => {
  it('is taken out of flow and pinned to the top of the viewport', () => {
    const { container } = render(<TrainingBand />)
    const band = container.firstElementChild

    expect(band).not.toBeNull()
    expect(band).toHaveClass('fixed', 'inset-x-0', 'top-0')
    // Chrome, not a control: it must never swallow a click meant for the header
    // it now lies over.
    expect(band).toHaveClass('pointer-events-none')
    expect(band).toHaveAttribute('aria-hidden')
  })

  it('keeps its own positioning when a caller adds classes', () => {
    const { container } = render(<TrainingBand className="opacity-80" />)
    const band = container.firstElementChild

    expect(band).toHaveClass('opacity-80')
    expect(band).toHaveClass('fixed')
  })
})

describe('TrainingBadge', () => {
  // KP Front's ÜBUNG tag (ENT-09): the word in ink on the hatching, no hue at all.
  it('is the hatched ink tag, never a hue', () => {
    const { getByText } = render(<TrainingBadge label="Übung" />)
    const tag = getByText('Übung')
    expect(tag).toHaveClass('training-hatch', 'text-foreground', 'uppercase')
    expect(tag.className).not.toMatch(/warning|amber|orange|destructive/)
  })

  it('folds to a square with the first letter where the word does not fit, named in full', () => {
    const { getByRole } = render(<TrainingBadge label="Exercice" square />)
    const tag = getByRole('img', { name: 'Exercice' })
    expect(tag).toHaveTextContent('E')
    expect(tag).toHaveClass('training-hatch')
  })
})

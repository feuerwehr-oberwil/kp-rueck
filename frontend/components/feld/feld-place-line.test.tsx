import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { useRef } from 'react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

import { FeldPlaceLine } from '@/components/feld/feld-place-line'

/** jsdom has no IntersectionObserver: this one hands its callback to the test. */
let report: (isIntersecting: boolean) => void = () => {}
class FakeObserver {
  constructor(
    callback: (entries: Pick<IntersectionObserverEntry, 'isIntersecting' | 'boundingClientRect' | 'rootBounds'>[]) => void,
  ) {
    // Hidden = ended above the root's top (61px); visible = still below it.
    report = isIntersecting =>
      callback([
        {
          isIntersecting,
          boundingClientRect: { bottom: isIntersecting ? 200 : 20 } as DOMRectReadOnly,
          rootBounds: { top: 61 } as DOMRectReadOnly,
        },
      ])
  }
  observe() {}
  disconnect() {}
}

function Detail() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div>
      <FeldPlaceLine number={6} address="Goldenthalweg 21" type="Elementarereignis" headerRef={ref} />
      <div ref={ref}>
        <h1>Goldenthalweg 21</h1>
      </div>
    </div>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('FeldPlaceLine (owner pick 2A)', () => {
  it('shows «6 Goldenthalweg 21 · Elementarereignis» only once the header is under the top bar', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    renderWithIntl(<Detail />)

    act(() => report(true))
    expect(screen.queryByTestId('feld-place-line')).toBeNull()

    act(() => report(false))
    const line = screen.getByTestId('feld-place-line')
    expect(line).toHaveTextContent('6Goldenthalweg 21· Elementarereignis')
    // Sticks under the top bar, never over it.
    expect(line.parentElement).toHaveClass('sticky', 'top-[calc(3.75rem+1px)]', 'h-0')

    act(() => report(true))
    expect(screen.queryByTestId('feld-place-line')).toBeNull()
  })
})

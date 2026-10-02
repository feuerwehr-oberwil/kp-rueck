import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'

import { ViewportInsets, useNavReserve } from '@/components/viewport-insets'

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name)

/** A visualViewport stand-in: an EventTarget whose height/offsetTop the test sets. */
class FakeVisualViewport extends EventTarget {
  height = window.innerHeight
  offsetTop = 0
  scale = 1
}

describe('ViewportInsets', () => {
  let fake: FakeVisualViewport
  beforeEach(() => {
    fake = new FakeVisualViewport()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake })
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-kb')
  })

  it('publishes the keyboard when a field has focus and the visual viewport shrinks', () => {
    render(
      <>
        <ViewportInsets />
        <input aria-label="Einsatzort" />
      </>,
    )
    expect(rootVar('--kb-inset')).toBe('0px')

    const input = document.querySelector('input')!
    act(() => {
      input.focus()
      fake.height = window.innerHeight - 300
      fake.dispatchEvent(new Event('resize'))
    })
    expect(rootVar('--kb-inset')).toBe('300px')
    expect(rootVar('--vv-height')).toBe(`${window.innerHeight - 300}px`)
    expect(document.documentElement.hasAttribute('data-kb')).toBe(true)

    // iOS pans to reveal the caret: the foot shrinks by the pan, the cap does not move
    act(() => {
      fake.offsetTop = 100
      fake.dispatchEvent(new Event('scroll'))
    })
    expect(rootVar('--kb-inset')).toBe('200px')
    expect(rootVar('--vv-height')).toBe(`${window.innerHeight - 300}px`)

    act(() => {
      fake.height = window.innerHeight
      fake.offsetTop = 0
      fake.dispatchEvent(new Event('resize'))
    })
    expect(rootVar('--kb-inset')).toBe('0px')
    expect(document.documentElement.hasAttribute('data-kb')).toBe(false)
  })

  it('reads no keyboard without a focused text field (pinch zoom, a closing keyboard)', () => {
    render(<ViewportInsets />)
    act(() => {
      fake.height = window.innerHeight - 300
      fake.dispatchEvent(new Event('resize'))
    })
    expect(rootVar('--kb-inset')).toBe('0px')
  })
})

function Nav({ height }: { height: number }) {
  const ref = useRef<HTMLElement>(null)
  useNavReserve(ref)
  return (
    <nav
      ref={(el) => {
        ref.current = el
        if (el) el.getBoundingClientRect = () => ({ height }) as DOMRect
      }}
    />
  )
}

describe('useNavReserve', () => {
  afterEach(() => document.documentElement.removeAttribute('style'))

  it('publishes the nav height while mounted and 0 after', () => {
    const { unmount } = render(<Nav height={94} />)
    expect(rootVar('--nav-reserve')).toBe('94px')
    unmount()
    expect(rootVar('--nav-reserve')).toBe('0px')
  })
})

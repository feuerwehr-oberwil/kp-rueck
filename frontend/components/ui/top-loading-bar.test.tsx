import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

import { TopLoadingBar, topLoading } from './top-loading-bar'

const bar = (container: HTMLElement) => container.querySelector<HTMLElement>('[aria-hidden] > div')!

describe('TopLoadingBar suppression', () => {
  it('stays invisible during a load while suppressed, and shows it once released', () => {
    const { container } = render(<TopLoadingBar />)
    let release!: () => void
    act(() => {
      release = topLoading.suppress()
      topLoading.start()
    })
    expect(bar(container).style.opacity).toBe('0')
    act(() => release())
    expect(bar(container).style.opacity).toBe('1')
    act(() => release()) // a second release is a no-op, never un-suppresses someone else
    expect(topLoading.isSuppressed()).toBe(false)
    act(() => topLoading.done())
  })
})

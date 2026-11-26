import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useScrollBlockIntoView } from '@/lib/hooks/use-scroll-block-into-view'

/** A scroller at y=100 that has scrolled 50px, and a block whose top is at y=400 on screen. */
function scene(blockTop = 400) {
  const scroller = document.createElement('div')
  scroller.scrollTop = 50
  scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
  const block = document.createElement('div')
  block.getBoundingClientRect = () => ({ top: blockTop }) as DOMRect
  return { scrollerRef: { current: scroller }, blockRef: { current: block } }
}

function flushFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
}

describe('useScrollBlockIntoView', () => {
  it('puts the block top `offset` px under the scroller top, a frame later', async () => {
    const { scrollerRef, blockRef } = scene()
    renderHook(() => useScrollBlockIntoView(scrollerRef, blockRef, 'reko', { offset: 16 }))
    expect(scrollerRef.current.scrollTop).toBe(50)
    await flushFrame()
    // 50 + (400 − 100) − 16
    expect(scrollerRef.current.scrollTop).toBe(334)
  })

  it('does nothing without a block, and nothing once unmounted before the frame', async () => {
    const { scrollerRef, blockRef } = scene()
    renderHook(() => useScrollBlockIntoView(scrollerRef, null, 'reko'))
    const { unmount } = renderHook(() => useScrollBlockIntoView(scrollerRef, blockRef, 'reko'))
    unmount()
    await flushFrame()
    expect(scrollerRef.current.scrollTop).toBe(50)
  })

  it('scrolls again for a new trigger', async () => {
    const { scrollerRef, blockRef } = scene()
    const spy = vi.spyOn(blockRef.current, 'getBoundingClientRect')
    const { rerender } = renderHook(({ trigger }) => useScrollBlockIntoView(scrollerRef, blockRef, trigger), {
      initialProps: { trigger: {} },
    })
    await flushFrame()
    rerender({ trigger: {} })
    await flushFrame()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('waits for `ready`, then scrolls once for that trigger', async () => {
    const { scrollerRef, blockRef } = scene()
    const spy = vi.spyOn(blockRef.current, 'getBoundingClientRect')
    const trigger = {}
    const { rerender } = renderHook(({ ready }) => useScrollBlockIntoView(scrollerRef, blockRef, trigger, { ready }), {
      initialProps: { ready: false },
    })
    await flushFrame()
    expect(spy).not.toHaveBeenCalled()
    rerender({ ready: true })
    await flushFrame()
    expect(spy).toHaveBeenCalledTimes(1)
    // The block reloads (ready off, on again) for the same request: no second scroll.
    rerender({ ready: false })
    rerender({ ready: true })
    await flushFrame()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

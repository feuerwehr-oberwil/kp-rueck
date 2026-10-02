'use client'

import { useEffect, type RefObject } from 'react'
import {
  keyboardGeometry,
  publishKeyboard,
  publishNavReserve,
  sampleViewport,
} from '@/lib/viewport-insets'

/**
 * Keeps `--kb-inset` / `--vv-height` / `html[data-kb]` in step with the on-screen keyboard (the
 * contract is documented in lib/viewport-insets.ts). Mounted once in the root layout; renders
 * nothing and never re-renders anything — the geometry lives in CSS.
 *
 * Measured per animation frame at most. iOS does not always fire a visualViewport event when the
 * keyboard goes away (swipe-to-dismiss, the accessory bar's «Fertig»), so focus leaving a field
 * re-measures a beat later as well; focus ENTERING a field while a keyboard is already up resizes
 * no viewport, so that re-measures too.
 */
export function ViewportInsets() {
  useEffect(() => {
    const vv = window.visualViewport
    let frame = 0
    let pending = false
    let last = ''
    const measure = () => {
      pending = false
      const g = keyboardGeometry(sampleViewport())
      const key = `${g.open}|${g.inset}|${g.visibleHeight}`
      if (key === last) return
      last = key
      publishKeyboard(g)
    }
    const update = () => {
      if (pending) return
      pending = true
      frame = requestAnimationFrame(measure)
    }
    let late: ReturnType<typeof setTimeout>[] = []
    const onFocusOut = () => {
      late.forEach(clearTimeout)
      late = [setTimeout(update, 250), setTimeout(update, 700)]
    }
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('focusin', update)
    window.addEventListener('focusout', onFocusOut)
    update()
    return () => {
      if (pending) cancelAnimationFrame(frame)
      late.forEach(clearTimeout)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('focusin', update)
      window.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  return null
}

/**
 * Publish the phone bottom nav's measured height as `--nav-reserve` for as long as it is
 * mounted. ResizeObserver, not `window.resize`: the nav grows with text zoom, the safe area and
 * landscape without the window changing size. Hidden (`md:hidden` → display:none) reads 0.
 */
export function useNavReserve(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => publishNavReserve(el.getBoundingClientRect().height)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      publishNavReserve(0)
    }
  }, [ref])
}

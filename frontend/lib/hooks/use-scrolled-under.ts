'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * True once the element in `ref` has scrolled up under a sticky bar of
 * `barHeightPx` at the top of the viewport – no part of it left below the bar.
 * False again when it scrolls back into view, and false without an
 * IntersectionObserver (server, jsdom).
 *
 * Used by `FeldPlaceLine`: the /feld detail's short Schadenplatz line shows only
 * once the full header is gone under the top bar.
 */
export function useScrolledUnder(ref: RefObject<HTMLElement | null>, barHeightPx: number): boolean {
  const [under, setUnder] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    // The root is the viewport minus the bar. «Not intersecting» is hidden under the bar only
    // when the element ends above the root's top – below the fold is not intersecting too.
    const observer = new IntersectionObserver(([entry]) => {
      const rootTop = entry.rootBounds?.top ?? barHeightPx
      setUnder(!entry.isIntersecting && entry.boundingClientRect.bottom <= rootTop)
    }, {
      rootMargin: `-${barHeightPx}px 0px 0px 0px`,
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, barHeightPx])
  return under
}

'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Scrolls `scrollerRef` so the top of `blockRef` sits `offset` px under the scroller's top.
 *
 * Runs when `blockRef` or `trigger` changes; pass `null` as `blockRef` for «nowhere» (a closed
 * sheet, no target). One frame late on purpose: a sheet that has just opened mounts its body in
 * the same commit, and the block has to be laid out before it can be measured.
 *
 * Used by the phone Einsatz sheet to land on the block a pointer named (lib/detail-target.ts).
 */
export function useScrollBlockIntoView(
  scrollerRef: RefObject<HTMLElement | null>,
  blockRef: RefObject<HTMLElement | null> | null,
  trigger: unknown,
  offset = 0,
): void {
  useEffect(() => {
    if (!blockRef) return
    const frame = requestAnimationFrame(() => {
      const scroller = scrollerRef.current
      const block = blockRef.current
      if (!scroller || !block) return
      scroller.scrollTop += block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollerRef, blockRef, trigger, offset])
}

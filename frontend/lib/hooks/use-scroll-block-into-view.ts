'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Scrolls `scrollerRef` so the top of `blockRef` sits `offset` px under the scroller's top –
 * once per `trigger`, as soon as `ready` says the block holds its real content.
 *
 * Pass `null` as `blockRef` for «nowhere» (a closed sheet, no target). `ready` exists for a block
 * that loads after it mounts: scrolling to its loading line would land on a placeholder (and be
 * clamped by the short body), and a block that grows later must not yank the reader back. One
 * frame late on purpose: a sheet that has just opened mounts its body in the same commit, and the
 * block has to be laid out before it can be measured.
 *
 * Used by the phone Einsatz sheet to land on the block a pointer named (lib/detail-target.ts).
 */
export function useScrollBlockIntoView(
  scrollerRef: RefObject<HTMLElement | null>,
  blockRef: RefObject<HTMLElement | null> | null,
  trigger: unknown,
  { offset = 0, ready = true }: { offset?: number; ready?: boolean } = {},
): void {
  // The trigger the last scroll answered: a re-render (or `ready` flipping again) for the same
  // request must not scroll a second time.
  const answered = useRef<{ trigger: unknown } | null>(null)
  useEffect(() => {
    if (!blockRef || !ready || answered.current?.trigger === trigger) return
    const frame = requestAnimationFrame(() => {
      const scroller = scrollerRef.current
      const block = blockRef.current
      if (!scroller || !block) return
      answered.current = { trigger }
      scroller.scrollTop += block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollerRef, blockRef, trigger, offset, ready])
}

'use client'

import { useEffect, type RefObject } from 'react'

/**
 * The wall's root font size, worked out live (VISUAL-07 C).
 *
 * A wall has no pointer to scroll a column with, so «everything visible» beats
 * «as large as possible» – but where everything fits, it should be as large as
 * it can be. Every size on the wall card is rem, so one number scales the whole
 * board: the largest root size at which no column body has to scroll.
 *
 * Bounds: never below 14px (the Meldung is 0.84rem ≈ 11.8px there, the address
 * 17.5px – the floor for reading from across a room; a column that still does
 * not fit at 14px scrolls, as before) and never above 20px (an almost empty
 * board would otherwise blow the top bar up too). Steps of 0.25px.
 */
export const WALL_FIT_MIN_PX = 14
export const WALL_FIT_MAX_PX = 20
const STEP_PX = 0.25

/** The column bodies the fit must not let scroll carry this attribute. */
const WALL_COLUMN_BODY_ATTR = 'data-wall-column-body'

/** Below `sm` the wall stacks its columns and scrolls the page (UX-PHONE-10): no fit there. */
const WALL_FIT_MEDIA = '(min-width: 640px)'

/**
 * The largest size in [min, max] (on the `step` grid) for which `fits` holds,
 * or `min` when none does. Binary search: `fits` is monotone – bigger type
 * never makes a column shorter.
 */
export function largestFitting(min: number, max: number, step: number, fits: (px: number) => boolean): number {
  let lo = 0
  let hi = Math.round((max - min) / step)
  if (!fits(min)) return min
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(min + mid * step)) lo = mid
    else hi = mid - 1
  }
  return min + lo * step
}

/**
 * Fits the wall under `boardRef`: sets `<html>`'s font size and re-fits when the
 * board is resized or anything in it changes (a card arrives, a column folds, a
 * search narrows it, a Meldung grows). Restores the page's own size on unmount
 * and below `sm`.
 */
export function useWallFit(boardRef: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const board = boardRef.current
    if (!enabled || !board) return
    const root = document.documentElement
    const original = root.style.fontSize
    const media = window.matchMedia(WALL_FIT_MEDIA)
    let frame = 0
    let disposed = false

    const fit = () => {
      frame = 0
      if (!media.matches) {
        root.style.fontSize = original
        return
      }
      const bodies = [...board.querySelectorAll<HTMLElement>(`[${WALL_COLUMN_BODY_ATTR}]`)]
      // Each probe sets the size and reads the result back – one synchronous
      // layout per probe, about five per fit.
      const fits = (px: number) => {
        root.style.fontSize = `${px}px`
        return bodies.every((body) => body.scrollHeight <= body.clientHeight + 1)
      }
      root.style.fontSize = `${largestFitting(WALL_FIT_MIN_PX, WALL_FIT_MAX_PX, STEP_PX, fits)}px`
    }
    const schedule = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(fit)
    }

    // The board's own box changes with the window and with the top bar, which
    // is rem too – the second fit after a resize lands on the same size.
    const resize = new ResizeObserver(schedule)
    resize.observe(board)
    // Content: the probes only touch <html>'s style, outside this subtree, so
    // the fit does not wake itself.
    const mutations = new MutationObserver(schedule)
    mutations.observe(board, { childList: true, subtree: true, characterData: true })
    media.addEventListener('change', schedule)
    // Sora arrives after first paint and sets wider than the fallback.
    void document.fonts?.ready.then(schedule)
    schedule()

    return () => {
      disposed = true
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      media.removeEventListener('change', schedule)
      root.style.fontSize = original
    }
  }, [boardRef, enabled])
}

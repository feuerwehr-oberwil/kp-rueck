/**
 * Swipe a phone bottom sheet down to close it — the decisions, kept pure so they can be tested
 * without a touch screen. The DOM side (touch listeners, transform, snap back, the swallowed
 * click) is `attachSwipe` in components/ui/sheet.tsx.
 *
 * Rules (ported in behaviour from KP Front's overlays/swipeDismiss, not its code):
 * 1. The grip and the sheet's header always drag. Anywhere else a press may become a drag only
 *    while EVERY scroller between the finger and the sheet (the sheet included) is at its very
 *    top: a list at its top inside a scrolled-down body scrolls the body back up. Scrolled
 *    content wins.
 * 2. A field is a field, a row is a handle (phone sweep 24.11.2026 #10, KP Front sweep
 *    28.10.2026 #1). A press on a row, a button or a link starts the pull like any other point
 *    of the body; a tap stays a tap (rule 3), and the click a real pull ends in is swallowed.
 *    What never starts it (`NO_DRAG_SELECTOR`): a field (a Select's combobox too), a slider, a
 *    trigger that opens its menu on the PRESS (Radix DropdownMenu – a pull would open it before
 *    any click could be swallowed), a canvas, a map, a sideways scroller with room (a chip row's
 *    swipe) and `data-swipe-ignore`.
 * 3. Nothing is claimed until the finger has travelled `ENGAGE_PX` mostly downwards; a tap, a
 *    still press, an upward or a sideways swipe stay with the content.
 * 4. Let go past `DISMISS_PX`, or flicked faster than `FLICK_VELOCITY` after `FLICK_PX`, and the
 *    sheet asks to close (through Radix, so a dirty-form guard on `onOpenChange` still asks
 *    first); otherwise it snaps back.
 */

/** Travel before the sheet starts following the finger. */
export const ENGAGE_PX = 10
/** Pulled at least this far → close. */
export const DISMISS_PX = 96
/** …or at least this far AND released faster than `FLICK_VELOCITY`. */
export const FLICK_PX = 40
/** px per ms — an ordinary deliberate pull lands well under this. */
export const FLICK_VELOCITY = 0.5
/** The snap back when the pull was not enough. Short: never make anyone wait. */
export const SNAP_MS = 180

/** Never starts a drag (rule 2): what reads the finger itself, and what acts on the press. A
 *  button or a link is NOT here – a row is a handle. `data-swipe-ignore` is the opt-out for a
 *  bespoke gesture surface. */
export const NO_DRAG_SELECTOR = [
  'input', 'select', 'textarea', '[contenteditable="true"]', '[role="combobox"]', '[role="slider"]',
  '[aria-haspopup="menu"]', 'canvas', '.maplibregl-map', '[data-swipe-ignore]',
].join(', ')

/** The handle: grip and header always drag (rule 1). */
export const HANDLE_SELECTOR = '[data-slot="sheet-grip"], [data-slot="sheet-header"]'

export interface SwipeStart {
  /** The press landed on a field, a slider, a map … (rule 2). */
  onField: boolean
  /** The press landed on the grip or header. */
  onHandle: boolean
  /** The press landed inside a sideways scroller that has room to scroll (rule 2). */
  inSidewaysScroller: boolean
  /** scrollTop of every vertical scroller from the finger up to the sheet; empty when none. */
  scrollTops: readonly number[]
}

/** May this press become a drag at all? */
export function canStartSwipe({ onField, onHandle, inSidewaysScroller, scrollTops }: SwipeStart): boolean {
  if (onField) return false
  if (onHandle) return true
  return !inSidewaysScroller && !anyScrolled(scrollTops)
}

/** Has any scroller under the finger moved off its top (rule 1)? */
export function anyScrolled(scrollTops: readonly number[]): boolean {
  return scrollTops.some((top) => top > 0)
}

export type SwipeIntent = 'pending' | 'engage' | 'reject'

/** Is the travel so far a pull on the sheet (rule 3)? */
export function swipeIntent(dx: number, dy: number): SwipeIntent {
  if (dy < -2 || (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4)) return 'reject'
  return dy >= ENGAGE_PX ? 'engage' : 'pending'
}

/** How far the sheet follows the finger once engaged. */
export function dragOffset(dy: number): number {
  return Math.max(0, dy - ENGAGE_PX)
}

/** Release: close or snap back (rule 4). `velocity` in px/ms, positive = downwards. */
export function shouldDismiss(offset: number, velocity: number): boolean {
  return offset > DISMISS_PX || (offset > FLICK_PX && velocity > FLICK_VELOCITY)
}

/**
 * Release velocity from the recent samples (px/ms): the speed over the last ~100 ms, not the
 * average since the press — a slow pull that ends in a flick is a flick.
 */
export function releaseVelocity(samples: ReadonlyArray<{ y: number; t: number }>, windowMs = 100): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let first = samples[samples.length - 2]
  for (let i = samples.length - 2; i >= 0; i--) {
    first = samples[i]
    if (last.t - samples[i].t >= windowMs) break
  }
  const dt = last.t - first.t
  return dt > 0 ? (last.y - first.y) / dt : 0
}

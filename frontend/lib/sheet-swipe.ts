/**
 * Swipe a phone bottom sheet down to close it — the decisions, kept pure so they can be tested
 * without a touch screen. The DOM side (touch listeners, transform, snap back) is
 * `useSheetSwipe` in components/ui/sheet.tsx.
 *
 * Rules (ported in behaviour from KP Front's swipeDismiss, not its code):
 * 1. Only a press on the grip or the sheet's header, or anywhere while the content under the
 *    finger is scrolled to its very top, may become a drag. Scrolled content wins.
 * 2. A control is a control: a press that starts on a button / field / link never drags, so the
 *    ✕ still closes on the first tap and a text field still takes its caret.
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

/** Never starts a drag (rule 2). `data-swipe-ignore` is the opt-out for a bespoke gesture surface. */
export const NO_DRAG_SELECTOR = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'label', '[role="button"]', '[role="switch"]',
  '[role="combobox"]', '[role="slider"]', '[contenteditable="true"]', 'canvas', '.maplibregl-map',
  '[data-swipe-ignore]',
].join(', ')

/** The handle: grip and header always drag (rule 1). */
export const HANDLE_SELECTOR = '[data-slot="sheet-grip"], [data-slot="sheet-header"]'

export interface SwipeStart {
  /** The press landed on a control (rule 2). */
  onControl: boolean
  /** The press landed on the grip or header. */
  onHandle: boolean
  /** scrollTop of the scroller under the finger; null when nothing under it scrolls. */
  scrollTop: number | null
}

/** May this press become a drag at all? */
export function canStartSwipe({ onControl, onHandle, scrollTop }: SwipeStart): boolean {
  if (onControl) return false
  if (onHandle) return true
  return scrollTop === null || scrollTop <= 0
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

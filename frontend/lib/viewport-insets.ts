/**
 * Phone viewport geometry, published as CSS variables on `<html>`.
 *
 * THE CONTRACT (other code reads these with a fallback, e.g. `var(--nav-reserve, 60px)`):
 *
 * - `--kb-inset`   px of the LAYOUT viewport's foot the on-screen keyboard hides right now — the
 *                  number a `position: fixed; bottom: …` element adds to stand ON the keyboard.
 *                  0 with no keyboard (and always on desktop).
 * - `--vv-top`     px from the LAYOUT viewport's top to the visual viewport's top edge while a
 *                  keyboard is up (`visualViewport.offsetTop`, i.e. how far iOS panned to reveal
 *                  the caret); 0 otherwise. `top: var(--vv-top)` is the visible band's top edge
 *                  for a `position: fixed` element.
 * - `--vv-height`  px of screen actually visible while the keyboard is up (the visual viewport);
 *                  the innerHeight otherwise. With `--vv-top` it describes the visible band
 *                  exactly: a phone bottom sheet fills it while the keyboard is up (globals.css).
 * - `--nav-reserve` measured border-box height of the phone bottom nav, safe area included.
 *                  0 when no nav is mounted or it is hidden (desktop: `md:hidden`).
 * - `--sheet-top`  px from the layout viewport's bottom to the top edge of the topmost open
 *                  bottom sheet (phone sheets and the desktop footer sheets alike); 0 when none.
 * - `html[data-kb]` present while a keyboard is up.
 *
 * Everything here is either pure (unit-tested) or a thin DOM writer; the listeners live in
 * `components/viewport-insets.tsx`.
 */

/** Below this much covered height it is not a keyboard: the address bar sliding, a rounding
 *  hair, iOS's hardware-keyboard accessory strip. Every real on-screen keyboard is far taller. */
export const MIN_KEYBOARD_PX = 40

export interface ViewportSample {
  /** `window.innerHeight` — the layout viewport, which a keyboard does NOT shrink on iOS or on
   *  Android Chrome's default `interactive-widget=resizes-visual`. */
  innerHeight: number
  /** `window.visualViewport`, null where the API is missing. */
  vv: { height: number; offsetTop: number; scale: number } | null
  /** Does a text-entry control hold focus? No caret, no keyboard — whatever the geometry says. */
  typing: boolean
  /** `navigator.virtualKeyboard.boundingRect.height` when a page opted into
   *  `overlaysContent` (Chromium only); there the viewports do not move at all. */
  virtualKeyboardHeight?: number | null
}

export interface KeyboardGeometry {
  open: boolean
  /** → `--kb-inset` */
  inset: number
  /** → `--vv-top` */
  top: number
  /** → `--vv-height` */
  visibleHeight: number
}

/**
 * Where the keyboard is, from one sample of the viewports.
 *
 * THE iOS MODEL. Safari never shrinks the layout viewport (`innerHeight`, the box `position:
 * fixed` is laid out in) for the keyboard. It shrinks the VISUAL viewport to the band left above
 * the keys, their accessory bar («AutoFill Contact», ✓) and — Safari 26 — the compact URL pill,
 * and it pans that band down inside the layout viewport to reveal the caret (`offsetTop`). In
 * layout coordinates the band is therefore `[offsetTop, offsetTop + vv.height]`, and that is what
 * `top` / `visibleHeight` publish. Android Chrome's default (`interactive-widget=resizes-visual`,
 * which Rück does not override) behaves the same way minus the pill; a page on `resizes-content`
 * would shrink `innerHeight` instead and simply read as no keyboard here, with the sheet standing
 * on the shrunk layout bottom.
 *
 * `inset` is the FOOT of the layout viewport that is out of sight: `innerHeight − offsetTop −
 * vv.height`, the number a `bottom:`-anchored bar adds to stand on the band's bottom edge.
 *
 * Nothing here depends on the pan in a way that moves the band on SCREEN: a sheet at `top:
 * offsetTop; height: vv.height` stays exactly where the band is however far iOS pans, so the
 * caret does not move when iOS pans and there is no pan/re-aim loop (the one KP Front measured
 * with a cap that grew as iOS panned).
 *
 * A pinch-zoomed page (`scale ≠ 1`) has `vv.height` in visual pixels; there the band arithmetic
 * does not hold in layout pixels, so it falls back to the keyboard's height.
 */
export function keyboardGeometry(s: ViewportSample): KeyboardGeometry {
  const H = s.innerHeight
  const closed: KeyboardGeometry = { open: false, inset: 0, top: 0, visibleHeight: Math.round(H) }

  // VirtualKeyboard API with overlaysContent: the viewports do not move, the keys cover the foot
  const vk = s.virtualKeyboardHeight
  if (vk != null && vk >= MIN_KEYBOARD_PX) {
    const k = Math.round(vk)
    return { open: true, inset: k, top: 0, visibleHeight: Math.max(0, Math.round(H - k)) }
  }
  if (!s.vv || !s.typing) return closed

  // Pinch-zoomed: the band is in visual px and wanders with the zoom; fall back to «layout top
  // down to the keyboard», which keeps the sheet's footer on the keys.
  const scale = s.vv.scale || 1
  if (Math.abs(scale - 1) > 0.01) {
    const k = Math.round(H - s.vv.height * scale)
    return k >= MIN_KEYBOARD_PX ? { open: true, inset: k, top: 0, visibleHeight: Math.round(H - k) } : closed
  }

  const covered = H - s.vv.height
  if (covered < MIN_KEYBOARD_PX) return closed
  // iOS can report the pan a hair past the layout bottom while it animates; clamp to the layout
  const top = Math.min(Math.max(0, Math.round(s.vv.offsetTop)), Math.max(0, Math.round(covered)))
  const visibleHeight = Math.round(s.vv.height)
  return { open: true, inset: Math.max(0, Math.round(H - top - visibleHeight)), top, visibleHeight }
}

/** `--sheet-top` for a sheet whose top edge is at `rectTop` (client px). */
export function sheetTopFrom(innerHeight: number, rectTop: number | null): number {
  if (rectTop == null) return 0
  return Math.max(0, Math.round(innerHeight - rectTop))
}

/** Text entry → a keyboard comes up. Buttons, checkboxes, sliders etc. do not raise one. */
const NON_TEXT_INPUTS = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
])
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type)
  return el instanceof HTMLElement && el.isContentEditable === true
}

/**
 * How far a scroller has to scroll (px, negative = up) so a field lies inside it with `margin`
 * to spare; 0 when it already does. A field taller than the box gets its TOP brought in.
 */
export function revealDelta(
  field: { top: number; bottom: number },
  box: { top: number; bottom: number },
  margin = 8,
): number {
  if (field.top < box.top + margin) return Math.round(field.top - box.top - margin)
  if (field.bottom > box.bottom - margin) {
    return Math.round(Math.min(field.bottom - box.bottom + margin, field.top - box.top - margin))
  }
  return 0
}

const PHONE_SHEET = '[data-slot="sheet-content"][data-side="bottom"]:not([data-docked])'

/**
 * After the keyboard moved a phone bottom sheet into the visible band, the field holding the
 * caret can sit behind the sheet's footer or above its scroll area — iOS aimed its pan at where
 * the field WAS. Scroll the sheet's own scroller (never the page: that would pan iOS again) so
 * the field is in view.
 */
export function revealFocusedField() {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || !isTypingTarget(el)) return
  const sheet = el.closest(PHONE_SHEET)
  if (!sheet) return
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) break
    if (node === sheet) return
    node = node.parentElement
  }
  if (!node) return
  const d = revealDelta(el.getBoundingClientRect(), node.getBoundingClientRect())
  if (d) node.scrollTop += d
}

/** One reading of the live viewports. */
export function sampleViewport(): ViewportSample {
  const vv = window.visualViewport
  const vk = (navigator as Navigator & {
    virtualKeyboard?: { overlaysContent?: boolean; boundingRect?: DOMRectReadOnly }
  }).virtualKeyboard
  return {
    innerHeight: window.innerHeight,
    vv: vv ? { height: vv.height, offsetTop: vv.offsetTop, scale: vv.scale } : null,
    typing: isTypingTarget(document.activeElement),
    virtualKeyboardHeight: vk?.overlaysContent ? vk.boundingRect?.height ?? 0 : null,
  }
}

const root = () => document.documentElement
const px = (n: number) => `${n}px`

export function publishKeyboard(g: KeyboardGeometry) {
  const r = root()
  r.style.setProperty('--kb-inset', px(g.inset))
  r.style.setProperty('--vv-top', px(g.top))
  r.style.setProperty('--vv-height', px(g.visibleHeight))
  r.toggleAttribute('data-kb', g.open)
  // a sheet standing on the keyboard moved with it
  scheduleSheetTop()
}

export function publishNavReserve(height: number) {
  root().style.setProperty('--nav-reserve', px(Math.max(0, Math.round(height))))
}

// ── --sheet-top: a registry of open bottom sheets, newest = topmost ─────────────────────────

const sheets: HTMLElement[] = []
let sheetPending = false
let sheetFrame = 0

function publishSheetTop() {
  sheetPending = false
  const top = [...sheets].reverse().find((el) => el.isConnected)
  root().style.setProperty(
    '--sheet-top',
    px(sheetTopFrom(window.innerHeight, top ? top.getBoundingClientRect().top : null)),
  )
}

/** Re-measure on the next frame (coalesced). Call after anything that moves a sheet. */
export function scheduleSheetTop() {
  if (typeof window === 'undefined' || sheetPending) return
  sheetPending = true
  sheetFrame = requestAnimationFrame(publishSheetTop)
}

/**
 * Register an open bottom sheet for `--sheet-top`. Re-measures on size changes, at the end of
 * its entrance animation and on window resizes; returns the unregister function.
 */
export function registerBottomSheet(el: HTMLElement): () => void {
  sheets.push(el)
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleSheetTop) : null
  ro?.observe(el)
  el.addEventListener('animationend', scheduleSheetTop)
  el.addEventListener('transitionend', scheduleSheetTop)
  window.addEventListener('resize', scheduleSheetTop)
  publishSheetTop()
  return () => {
    const i = sheets.lastIndexOf(el)
    if (i >= 0) sheets.splice(i, 1)
    ro?.disconnect()
    el.removeEventListener('animationend', scheduleSheetTop)
    el.removeEventListener('transitionend', scheduleSheetTop)
    window.removeEventListener('resize', scheduleSheetTop)
    // publish synchronously: a closed sheet must not leave toasts hovering over nothing
    if (sheetPending) cancelAnimationFrame(sheetFrame)
    publishSheetTop()
  }
}

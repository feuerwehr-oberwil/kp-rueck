/**
 * Keeping a dialog or slide-up open while a toast is dismissed.
 *
 * Sonner renders its stack in a portal at the end of `<body>`, and the
 * «Alle ausblenden» pill sits beside it – so to Radix both are *outside* any
 * open panel, and closing a toast closed the panel underneath it too. A stray
 * toast should never cost somebody the form they were half-way through filling
 * in, least of all at 3am.
 */

/** Marks anything that belongs to the toast layer but is not a sonner node. */
export const TOAST_LAYER_ATTR = "data-toast-layer"

const TOAST_LAYER_SELECTOR = `[data-sonner-toaster],[data-sonner-toast],[${TOAST_LAYER_ATTR}]`

/** Radix hands us a CustomEvent whose detail carries the real DOM event. */
interface OutsideEvent {
  target?: EventTarget | null
  detail?: unknown
  preventDefault: () => void
}

function originalTarget(event: OutsideEvent): EventTarget | null {
  const detail = event.detail as { originalEvent?: Event } | undefined
  return detail?.originalEvent?.target ?? event.target ?? null
}

/**
 * Is this event target a toast, the toast stack, or the dismiss-all pill?
 *
 * `Element`, not `HTMLElement`: a toast's close ✕ and its undo/info action
 * icons are `<svg>`/`<path>` nodes, which are SVGElement. Guarding only
 * HTMLElement let a click on the ✕ fall through as an outside interaction and
 * close the panel — the exact bug this file exists to prevent. Both HTML and
 * SVG elements support `.closest`, so this still walks up to the container.
 */
export function isToastLayer(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false
  return Boolean(target.closest(TOAST_LAYER_SELECTOR))
}

/**
 * Wrap an `onInteractOutside`/`onPointerDownOutside` handler so interactions
 * with the toast layer never dismiss the panel. Anything else is passed on to
 * the caller's own handler unchanged.
 */
export function ignoreToastLayer<E extends OutsideEvent>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (isToastLayer(originalTarget(event))) {
      event.preventDefault()
      return
    }
    handler?.(event)
  }
}

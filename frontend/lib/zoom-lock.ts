import type { Viewport } from 'next'

/** The command board owns its touch gestures. Public forms and help override the viewport
 * in their route layout and opt back into browser magnification via data-page-zoom. */
export const APP_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

/** Where a pinch is the content's own: every MapLibre map (`base-map.tsx` and the pickers). */
const ZOOMABLE = '.maplibregl-map'

const inZoomable = (target: EventTarget | null) => target instanceof Element && !!target.closest(ZOOMABLE)

/**
 * Cancel page zoom gestures outside a map. Returns the undo (for the effect's cleanup).
 * The `gesture*` block only on a touch device: macOS Safari sends the same events for a trackpad
 * pinch, and on a desk the page may zoom like any web page (⌘+/− keep working either way).
 */
export function lockChromeZoom(doc: Document = document): () => void {
  const listeners: [string, (event: Event) => void][] = []
  const cancelOutsideMap = (event: Event) => {
    if (!inZoomable(event.target) && !doc.querySelector('[data-page-zoom]')) event.preventDefault()
  }
  if (navigator.maxTouchPoints > 0) {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) listeners.push([type, cancelOutsideMap])
  }
  // Two fingers moving = a pinch. One finger (scrolling, a drag) is never touched.
  listeners.push([
    'touchmove',
    (event) => {
      if ((event as TouchEvent).touches.length > 1) cancelOutsideMap(event)
    },
  ])
  for (const [type, listener] of listeners) doc.addEventListener(type, listener, { passive: false })
  return () => {
    for (const [type, listener] of listeners) doc.removeEventListener(type, listener)
  }
}

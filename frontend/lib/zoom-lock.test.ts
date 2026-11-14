import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { APP_VIEWPORT, lockChromeZoom } from '@/lib/zoom-lock'

const FRONTEND = resolve(__dirname, '..')

/** A cancelable event of `type` dispatched on `target`; true when something cancelled it. */
function cancelled(target: EventTarget, type: string, touches = 0): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true })
  if (touches) Object.defineProperty(event, 'touches', { value: { length: touches } })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

describe('zoom lock – app-wide, the map keeps its pinch', () => {
  let page: HTMLElement
  let canvas: HTMLElement
  let unlock: () => void
  const touchPoints = Object.getOwnPropertyDescriptor(Navigator.prototype, 'maxTouchPoints')

  beforeEach(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    document.body.innerHTML = '<main><p id="page">Board</p><div class="maplibregl-map"><canvas id="canvas"></canvas></div></main>'
    page = document.getElementById('page')!
    canvas = document.getElementById('canvas')!
    unlock = lockChromeZoom()
  })
  afterEach(() => {
    unlock()
    if (touchPoints) Object.defineProperty(navigator, 'maxTouchPoints', touchPoints)
    else Reflect.deleteProperty(navigator, 'maxTouchPoints')
  })

  it('cancels an iOS pinch gesture and a two-finger move on the page', () => {
    expect(cancelled(page, 'gesturestart')).toBe(true)
    expect(cancelled(page, 'gesturechange')).toBe(true)
    expect(cancelled(page, 'touchmove', 2)).toBe(true)
  })

  it('leaves one-finger scrolling alone', () => {
    expect(cancelled(page, 'touchmove', 1)).toBe(false)
  })

  it('leaves a pinch on a MapLibre map alone', () => {
    expect(cancelled(canvas, 'gesturestart')).toBe(false)
    expect(cancelled(canvas, 'touchmove', 2)).toBe(false)
  })

  it('undoes itself', () => {
    unlock()
    expect(cancelled(page, 'gesturestart')).toBe(false)
    expect(cancelled(page, 'touchmove', 2)).toBe(false)
  })

  it('lets a desk trackpad pinch (gesture events, no touch points) zoom the page', () => {
    unlock()
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })
    unlock = lockChromeZoom()
    expect(cancelled(page, 'gesturestart')).toBe(false)
  })
})

describe('zoom lock – the declarative half', () => {
  it('fixes the viewport at scale 1, in the root layout (every route)', () => {
    expect(APP_VIEWPORT).toMatchObject({ initialScale: 1, maximumScale: 1, userScalable: false })
    // the root layout imports fonts jsdom cannot load, so this one stays a source check
    const layout = readFileSync(resolve(FRONTEND, 'app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/export const viewport\b[^=]*= APP_VIEWPORT/)
    expect(layout).toContain('<ZoomLock />')
  })

  it('has the CSS half: pan-only touch on <html>, small text steps lifted to 16px on fields', () => {
    const css = readFileSync(resolve(FRONTEND, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/html \{\s*touch-action: pan-x pan-y;/)
    expect(css).toMatch(/--text-sm: 1rem;/)
  })
})

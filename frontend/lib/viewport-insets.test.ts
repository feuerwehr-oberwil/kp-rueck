import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MIN_KEYBOARD_PX,
  isTypingTarget,
  keyboardGeometry,
  publishKeyboard,
  publishNavReserve,
  registerBottomSheet,
  sheetTopFrom,
} from '@/lib/viewport-insets'

const vv = (height: number, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale })
const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name)

describe('keyboardGeometry', () => {
  it('reads closed without a keyboard', () => {
    expect(keyboardGeometry({ innerHeight: 844, vv: vv(844), typing: true })).toEqual({
      open: false, inset: 0, visibleHeight: 844,
    })
  })

  it('measures an iOS / Android keyboard as the hidden foot of the layout viewport', () => {
    expect(keyboardGeometry({ innerHeight: 844, vv: vv(544), typing: true })).toEqual({
      open: true, inset: 300, visibleHeight: 544,
    })
  })

  it('subtracts the iOS pan from the inset but never from the height cap', () => {
    // Safari panned the visual viewport by 120px to reveal the caret
    const g = keyboardGeometry({ innerHeight: 844, vv: vv(544, 120), typing: true })
    expect(g).toEqual({ open: true, inset: 180, visibleHeight: 544 })
  })

  it('stays open with inset 0 when iOS has panned the whole keyboard height', () => {
    expect(keyboardGeometry({ innerHeight: 844, vv: vv(544, 300), typing: true })).toEqual({
      open: true, inset: 0, visibleHeight: 544,
    })
  })

  it('believes no keyboard while no text field holds the caret', () => {
    expect(keyboardGeometry({ innerHeight: 844, vv: vv(544), typing: false }).open).toBe(false)
  })

  it('ignores an address bar sliding (below MIN_KEYBOARD_PX)', () => {
    const g = keyboardGeometry({ innerHeight: 844, vv: vv(844 - (MIN_KEYBOARD_PX - 1)), typing: true })
    expect(g.open).toBe(false)
    expect(g.inset).toBe(0)
  })

  it('does not read a pinch-zoom as a keyboard', () => {
    // scale 2: vv.height is in visual px, half the layout height, no keyboard at all
    expect(keyboardGeometry({ innerHeight: 844, vv: vv(422, 0, 2), typing: true }).open).toBe(false)
    // zoomed AND a keyboard: falls back to the keyboard's height
    expect(keyboardGeometry({ innerHeight: 844, vv: vv(272, 50, 2), typing: true })).toEqual({
      open: true, inset: 300, visibleHeight: 544,
    })
  })

  it('takes the VirtualKeyboard API when a page opted into overlaysContent', () => {
    expect(
      keyboardGeometry({ innerHeight: 844, vv: vv(844), typing: false, virtualKeyboardHeight: 320 }),
    ).toEqual({ open: true, inset: 320, visibleHeight: 524 })
  })

  it('reads closed without the visualViewport API', () => {
    expect(keyboardGeometry({ innerHeight: 700, vv: null, typing: true }).open).toBe(false)
  })
})

describe('sheetTopFrom', () => {
  it('is the distance from the viewport bottom to the sheet top', () => {
    expect(sheetTopFrom(844, 184.6)).toBe(659)
    expect(sheetTopFrom(844, null)).toBe(0)
    expect(sheetTopFrom(844, 900)).toBe(0)
  })
})

describe('isTypingTarget', () => {
  it('counts text entry, not buttons or checkboxes', () => {
    const make = (html: string) => {
      const d = document.createElement('div')
      d.innerHTML = html
      return d.firstElementChild
    }
    expect(isTypingTarget(make('<input type="text">'))).toBe(true)
    expect(isTypingTarget(make('<input type="tel">'))).toBe(true)
    expect(isTypingTarget(make('<textarea></textarea>'))).toBe(true)
    expect(isTypingTarget(make('<input type="checkbox">'))).toBe(false)
    expect(isTypingTarget(make('<button></button>'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('publishing', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-kb')
    vi.restoreAllMocks()
  })

  it('writes the keyboard vars and the data-kb flag', () => {
    publishKeyboard({ open: true, inset: 300, visibleHeight: 544 })
    expect(rootVar('--kb-inset')).toBe('300px')
    expect(rootVar('--vv-height')).toBe('544px')
    expect(document.documentElement.hasAttribute('data-kb')).toBe(true)
    publishKeyboard({ open: false, inset: 0, visibleHeight: 844 })
    expect(rootVar('--kb-inset')).toBe('0px')
    expect(document.documentElement.hasAttribute('data-kb')).toBe(false)
  })

  it('rounds the nav reserve', () => {
    publishNavReserve(94.6)
    expect(rootVar('--nav-reserve')).toBe('95px')
  })

  it('publishes --sheet-top for the topmost registered sheet and clears it on close', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    const sheet = (top: number) => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      el.getBoundingClientRect = () => ({ top }) as DOMRect
      return el
    }
    const lower = sheet(window.innerHeight - 300)
    const offLower = registerBottomSheet(lower)
    expect(rootVar('--sheet-top')).toBe('300px')

    const upper = sheet(window.innerHeight - 500)
    const offUpper = registerBottomSheet(upper)
    expect(rootVar('--sheet-top')).toBe('500px')

    offUpper()
    expect(rootVar('--sheet-top')).toBe('300px')
    offLower()
    expect(rootVar('--sheet-top')).toBe('0px')
    lower.remove()
    upper.remove()
  })
})

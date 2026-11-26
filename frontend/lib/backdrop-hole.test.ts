import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openHoleOver } from './backdrop-hole'

// jsdom has no layout: what lies under the pointer and every box are stubbed.
function rect(x: number, y: number, w: number, h: number) {
  return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) } as DOMRect
}

describe('openHoleOver', () => {
  let backdrop: HTMLDivElement
  let card: HTMLDivElement
  let bare: HTMLDivElement
  let under: Element[]

  beforeEach(() => {
    vi.useFakeTimers()
    backdrop = document.createElement('div')
    card = document.createElement('div')
    card.setAttribute('data-board-card', '')
    card.append(document.createElement('span'))
    bare = document.createElement('div')
    document.body.append(backdrop, card, bare)
    backdrop.getBoundingClientRect = () => rect(0, 0, 1000, 800)
    card.getBoundingClientRect = () => rect(100, 200, 240, 120)
    under = [backdrop, bare]
    document.elementsFromPoint = () => under
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  const move = () => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, clientY: 250 }))
    vi.advanceTimersToNextFrame()
  }

  it('cuts the grabbable element out of the backdrop, and closes again off it', () => {
    const close = openHoleOver(backdrop, '[data-board-card]')
    move()
    expect(backdrop.style.clipPath).toBe('')

    under = [backdrop, card.firstElementChild!]
    move()
    // the whole backdrop, minus the card with 4px of air (the browser may space the path out)
    expect(backdrop.style.clipPath.replace(/\s/g, '')).toBe('path(evenodd,"M00H1000V800H0ZM96196h248v128h-248Z")')

    under = [backdrop, bare]
    move()
    expect(backdrop.style.clipPath).toBe('')
    close()
  })

  it('leaves no hole and no listener behind when the backdrop goes', () => {
    const close = openHoleOver(backdrop, '[data-board-card]')
    under = [card]
    move()
    expect(backdrop.style.clipPath).not.toBe('')
    close()
    expect(backdrop.style.clipPath).toBe('')
    // a card under the pointer again: nobody listens any more
    move()
    expect(backdrop.style.clipPath).toBe('')
  })
})

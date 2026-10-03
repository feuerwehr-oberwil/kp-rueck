import { describe, expect, it } from 'vitest'
import { boardDetailHref, boardDetailSurface, incidentDetailTarget, isPhoneViewport } from './incident-detail'

describe('incidentDetailTarget — where «open this Einsatz» goes', () => {
  it('opens the phone Einsatz sheet on a phone, without leaving the page', () => {
    expect(incidentDetailTarget('abc', { phone: true })).toEqual({ kind: 'phone-sheet', incidentId: 'abc' })
  })

  it('hands the Einsatz to the board’s detail panel on desktop', () => {
    expect(incidentDetailTarget('abc', { phone: false })).toEqual({ kind: 'board', href: '/?highlight=abc&detail=1' })
  })
})

describe('boardDetailHref', () => {
  it('is the link the board reads (highlight + detail, optional tab)', () => {
    expect(boardDetailHref('a b')).toBe('/?highlight=a%20b&detail=1')
    expect(boardDetailHref('x', 'reko')).toBe('/?highlight=x&detail=1&tab=reko')
  })
})

describe('boardDetailSurface — what the board opens for a notification or ?detail=1', () => {
  it('a notification on a phone opens the phone Einsatz sheet, never the desktop modal', () => {
    expect(boardDetailSurface({ phone: true, wide: false, allowModal: true })).toBe('phone-sheet')
  })

  it('desktop is unchanged: side panel when wide, modal when narrower', () => {
    expect(boardDetailSurface({ phone: false, wide: true, allowModal: true })).toBe('side-panel')
    expect(boardDetailSurface({ phone: false, wide: false, allowModal: true })).toBe('modal')
  })

  it('a sidebar binding (no overlay wanted) opens nothing on a narrow screen, phone included', () => {
    expect(boardDetailSurface({ phone: true, wide: false, allowModal: false })).toBe('none')
    expect(boardDetailSurface({ phone: false, wide: false, allowModal: false })).toBe('none')
    expect(boardDetailSurface({ phone: false, wide: true, allowModal: false })).toBe('side-panel')
  })
})

describe('isPhoneViewport', () => {
  it('reads the width now (the hook is still false on the first render a ?detail=1 link acts on)', () => {
    const width = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    expect(isPhoneViewport()).toBe(true)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 768 })
    expect(isPhoneViewport()).toBe(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  })
})

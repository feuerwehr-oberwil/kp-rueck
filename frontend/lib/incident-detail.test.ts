import { describe, expect, it } from 'vitest'
import { boardDetailHref, incidentDetailTarget } from './incident-detail'

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

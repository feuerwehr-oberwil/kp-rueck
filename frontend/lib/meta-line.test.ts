import { describe, expect, it } from 'vitest'
import { metaFacts } from '@/lib/meta-line'

const NBSP = ' '

describe('metaFacts', () => {
  it('glues each fact and breaks only before the «·», which goes with the next fact', () => {
    const line = metaFacts(['Stopp 1 von 4', 'Pio', '1 Gerät'])
    expect(line).toBe(`Stopp${NBSP}1${NBSP}von${NBSP}4 ·${NBSP}Pio ·${NBSP}1${NBSP}Gerät`)
    // The only breakable spaces are the ones in front of a separator.
    expect(line.split(' ')).toEqual([`Stopp${NBSP}1${NBSP}von${NBSP}4`, `·${NBSP}Pio`, `·${NBSP}1${NBSP}Gerät`])
  })

  it('drops empty and falsy parts', () => {
    expect(metaFacts(['3 Pers.', '', false, null, undefined, '  '])).toBe(`3${NBSP}Pers.`)
    expect(metaFacts([])).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { phoneAdvice } from '@/lib/phone-plausibility'

describe('phoneAdvice', () => {
  it('is silent for a complete Swiss number in every common spelling', () => {
    for (const n of ['079 123 45 67', '+41 79 123 45 67', '0041 79 123 45 67', '+41 (0)79 123 45 67', '061/123 45 67']) {
      expect(phoneAdvice(n)).toBeNull()
    }
  })

  it('flags a national number a digit short or long', () => {
    expect(phoneAdvice('079 123 45')).toEqual({ kind: 'short', digits: 8, expected: 10 })
    expect(phoneAdvice('079 123 45 678')).toEqual({ kind: 'long', digits: 11, expected: 10 })
    expect(phoneAdvice('+41 79 123 45')).toEqual({ kind: 'short', digits: 9, expected: 11 })
  })

  it('leaves alone what it cannot know: empty, foreign, service numbers', () => {
    for (const n of ['', '   ', '+49 30 1234567', '0049 30 1234567', '118', '144']) {
      expect(phoneAdvice(n)).toBeNull()
    }
  })
})

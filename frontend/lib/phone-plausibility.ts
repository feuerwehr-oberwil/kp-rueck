/**
 * Is this phone number worth a second look?
 *
 * ADVICE, never a gate: the person calling back is on the other end of a bad
 * line, and a KP that cannot save «079 123 45» because one digit was swallowed
 * has lost the seven it did get. So this only answers «does the digit count fit
 * a Swiss number?» and the form says so in amber — creating still works.
 *
 * Deliberately narrow, so it never cries wolf:
 * - national `0…` numbers have 10 digits;
 * - `+41` / `0041` numbers have 11 / 13 digits (country code included);
 * - anything else (other countries, 3-digit service numbers, an extension
 *   without a prefix) is left alone — we cannot know;
 * - «+41 (0)79 …» counts without the bracketed zero.
 */

export interface PhoneAdvice {
  kind: 'short' | 'long'
  /** Digits typed. */
  digits: number
  /** Digits a number of this shape has. */
  expected: number
}

export function phoneAdvice(raw: string | null | undefined): PhoneAdvice | null {
  // «+41 (0)79 …» — the bracketed trunk zero is not dialled.
  const value = (raw ?? '').replace(/\(\s*0\s*\)/g, '').trim()
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (!digits) return null

  let expected: number | null = null
  if (value.startsWith('+')) {
    if (digits.startsWith('41')) expected = 11
  } else if (digits.startsWith('0041')) {
    expected = 13
  } else if (digits.startsWith('00')) {
    expected = null // another country, dialled the long way round
  } else if (digits.startsWith('0')) {
    expected = 10
  }
  if (expected === null || digits.length === expected) return null
  return { kind: digits.length < expected ? 'short' : 'long', digits: digits.length, expected }
}

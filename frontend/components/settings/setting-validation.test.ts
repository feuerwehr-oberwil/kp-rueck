import { describe, expect, it } from 'vitest'
import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  normalizeDecimal,
  validateRangedSetting,
} from '@/components/settings/setting-validation'

describe('validateRangedSetting', () => {
  it('accepts a station coordinate', () => {
    expect(validateRangedSetting('47.516377', LATITUDE_RANGE)).toBeNull()
    expect(validateRangedSetting('7.561800', LONGITUDE_RANGE)).toBeNull()
  })

  it('accepts the German decimal comma a Swiss spreadsheet pastes', () => {
    expect(validateRangedSetting('47,516377', LATITUDE_RANGE)).toBeNull()
  })

  it('accepts an empty value – clearing a setting is a legitimate edit', () => {
    expect(validateRangedSetting('', LATITUDE_RANGE)).toBeNull()
    expect(validateRangedSetting('   ', LATITUDE_RANGE)).toBeNull()
  })

  it('rejects text', () => {
    expect(validateRangedSetting('Oberwil', LATITUDE_RANGE)).toBe('notANumber')
    expect(validateRangedSetting('47.5N', LATITUDE_RANGE)).toBe('notANumber')
  })

  it('rejects a longitude typed into the latitude field', () => {
    expect(validateRangedSetting('117.56', LATITUDE_RANGE)).toBe('outOfRange')
    expect(validateRangedSetting('117.56', LONGITUDE_RANGE)).toBeNull()
  })

  it('treats the bounds themselves as valid', () => {
    expect(validateRangedSetting('-90', LATITUDE_RANGE)).toBeNull()
    expect(validateRangedSetting('90', LATITUDE_RANGE)).toBeNull()
    expect(validateRangedSetting('90.0001', LATITUDE_RANGE)).toBe('outOfRange')
  })
})

describe('normalizeDecimal', () => {
  it('produces something parseFloat reads whole', () => {
    expect(normalizeDecimal(' 47,516377 ')).toBe('47.516377')
    expect(parseFloat(normalizeDecimal('47,5'))).toBe(47.5)
  })
})

import { describe, expect, it } from 'vitest'
import { isIncidentStatus } from './incidents'

describe('isIncidentStatus', () => {
  it('takes the seven statuses and nothing off the prototype', () => {
    expect(isIncidentStatus('reko_done')).toBe(true)
    expect(isIncidentStatus('constructor')).toBe(false)
    expect(isIncidentStatus('toString')).toBe(false)
  })
})

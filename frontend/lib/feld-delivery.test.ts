import { describe, it, expect } from 'vitest'
import { deliveryReducer, isBusy, IDLE, type DeliveryState } from './feld-delivery'

describe('deliveryReducer', () => {
  it('goes idle → pending → sent', () => {
    const pending = deliveryReducer(IDLE, { type: 'send', action: 'message', label: 'Verstärkung nötig' })
    expect(pending).toMatchObject({ status: 'pending', action: 'message', label: 'Verstärkung nötig' })

    const sent = deliveryReducer(pending, { type: 'settled', ok: true, attempt: 1 })
    expect(sent).toMatchObject({ status: 'sent', label: 'Verstärkung nötig' })
  })

  it('keeps the label on failure, so the crew is told WHAT did not arrive', () => {
    const pending = deliveryReducer(IDLE, { type: 'send', action: 'pickup', label: 'Abholung' })
    const failed = deliveryReducer(pending, { type: 'settled', ok: false, attempt: 1 })
    expect(failed).toMatchObject({ status: 'failed', action: 'pickup', label: 'Abholung' })
  })

  it('ignores an answer from an attempt that is no longer on screen', () => {
    // Bad connection: the first request finally times out AFTER the crew already
    // hit "Nochmals senden". That late failure must not paint the second
    // attempt red.
    const first = deliveryReducer(IDLE, { type: 'send', action: 'message', label: 'Test' })
    const second = deliveryReducer(first, { type: 'send', action: 'message', label: 'Test' })
    const stale = deliveryReducer(second, { type: 'settled', ok: false, attempt: 1 })
    expect(stale).toBe(second)
    expect(stale.status).toBe('pending')

    const settled = deliveryReducer(stale, { type: 'settled', ok: true, attempt: 2 })
    expect(settled.status).toBe('sent')
  })

  it('ignores a result that arrives after the state was cleared', () => {
    const pending = deliveryReducer(IDLE, { type: 'send', action: 'arrived', label: 'Angekommen' })
    const cleared = deliveryReducer(pending, { type: 'clear' })
    expect(deliveryReducer(cleared, { type: 'settled', ok: true, attempt: 1 })).toEqual(IDLE)
  })

  it('a retry from a failed state starts a fresh attempt', () => {
    const failed: DeliveryState = { status: 'failed', action: 'message', label: 'Test', attempt: 1 }
    const retry = deliveryReducer(failed, { type: 'send', action: 'message', label: 'Test' })
    expect(retry).toMatchObject({ status: 'pending', attempt: 2 })
    // The stale answer of attempt 1 still cannot touch it.
    expect(deliveryReducer(retry, { type: 'settled', ok: false, attempt: 1 })).toBe(retry)
  })
})

describe('isBusy', () => {
  it('locks only while a request is in flight', () => {
    const pending = deliveryReducer(IDLE, { type: 'send', action: 'pickup', label: 'Abholung' })
    expect(isBusy(pending)).toBe(true)
    expect(isBusy(pending, 'pickup')).toBe(true)
    expect(isBusy(pending, 'message')).toBe(false)
    expect(isBusy(deliveryReducer(pending, { type: 'settled', ok: true, attempt: 1 }))).toBe(false)
    expect(isBusy(IDLE)).toBe(false)
  })
})

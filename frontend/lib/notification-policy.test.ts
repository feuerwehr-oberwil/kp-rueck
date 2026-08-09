import { describe, it, expect } from 'vitest'
import { planToastBurst, toastPolicyFor, TOAST_BURST_LIMIT } from './notification-policy'
import type { Notification, NotificationSeverity, NotificationType } from './types/notification'

let clock = 0

function make(
  type: NotificationType,
  severity: NotificationSeverity,
  overrides: Partial<Notification> = {}
): Notification {
  clock += 1000
  return {
    id: overrides.id ?? `n-${clock}`,
    type,
    severity,
    message: `${type} ${clock}`,
    created_at: overrides.created_at ?? new Date(clock),
    dismissed: false,
    ...overrides,
  }
}

describe('toastPolicyFor', () => {
  it('treats the two field types a crew cannot resolve alone as urgent', () => {
    expect(toastPolicyFor(make('field_pickup', 'warning'))).toBe('urgent')
    expect(toastPolicyFor(make('field_message', 'info'))).toBe('urgent')
  })

  it('keeps the confirmations quiet or normal', () => {
    expect(toastPolicyFor(make('field_arrived', 'info'))).toBe('quiet')
    expect(toastPolicyFor(make('rapport_submitted', 'info'))).toBe('normal')
    expect(toastPolicyFor(make('field_complete', 'info'))).toBe('normal')
  })

  it('falls back to severity for everything else', () => {
    expect(toastPolicyFor(make('time_overdue', 'warning'))).toBe('urgent')
    expect(toastPolicyFor(make('no_materials', 'critical'))).toBe('urgent')
    expect(toastPolicyFor(make('vehicle_arrived', 'info'))).toBe('normal')
  })
})

describe('planToastBurst', () => {
  it('shows a small batch in the order it happened, oldest first', () => {
    const first = make('vehicle_arrived', 'info', { created_at: new Date(1000) })
    const second = make('vehicle_arrived', 'info', { created_at: new Date(2000) })
    // The API hands them over newest-first.
    const plan = planToastBurst([second, first], 3)
    expect(plan.toast.map((n) => n.id)).toEqual([first.id, second.id])
    expect(plan.overflow).toHaveLength(0)
  })

  it('is deterministic when two notifications share a timestamp', () => {
    const a = make('vehicle_arrived', 'info', { id: 'aaa', created_at: new Date(5000) })
    const b = make('vehicle_arrived', 'info', { id: 'bbb', created_at: new Date(5000) })
    expect(planToastBurst([b, a], 3).toast.map((n) => n.id)).toEqual(['aaa', 'bbb'])
    expect(planToastBurst([a, b], 3).toast.map((n) => n.id)).toEqual(['aaa', 'bbb'])
  })

  it('collapses a storm into a capped stack plus an overflow rest', () => {
    const burst = Array.from({ length: 20 }, () => make('vehicle_arrived', 'info'))
    const plan = planToastBurst(burst, 3)
    // The summary occupies one of the three slots.
    expect(plan.toast).toHaveLength(2)
    expect(plan.overflow).toHaveLength(18)
    expect(plan.toast.length + plan.overflow.length).toBe(20)
  })

  it('never drops an urgent notification into the overflow', () => {
    const noise = Array.from({ length: 15 }, () => make('vehicle_arrived', 'info'))
    const pickup = make('field_pickup', 'warning')
    const message = make('field_message', 'info')
    const plan = planToastBurst([...noise, pickup, message], 3)

    const toasted = plan.toast.map((n) => n.id)
    expect(toasted).toContain(pickup.id)
    expect(toasted).toContain(message.id)
    expect(plan.overflow.map((n) => n.id)).not.toContain(pickup.id)
    expect(plan.overflow.map((n) => n.id)).not.toContain(message.id)
  })

  it('shows every urgent one even when they alone exceed the cap', () => {
    const urgent = Array.from({ length: 6 }, () => make('time_overdue', 'warning'))
    const plan = planToastBurst(urgent, 3)
    expect(plan.toast).toHaveLength(6)
    expect(plan.overflow).toHaveLength(0)
  })

  it('routes quiet types to the bell only — no toast, no summary', () => {
    const arrived = make('field_arrived', 'info')
    const plan = planToastBurst([arrived], 3)
    expect(plan.toast).toHaveLength(0)
    expect(plan.overflow).toHaveLength(0)
    expect(plan.quiet.map((n) => n.id)).toEqual([arrived.id])
  })

  it('accounts for every notification exactly once', () => {
    const burst = [
      make('field_arrived', 'info'),
      make('field_pickup', 'warning'),
      make('rapport_submitted', 'info'),
      ...Array.from({ length: 9 }, () => make('vehicle_arrived', 'info')),
    ]
    const plan = planToastBurst(burst, TOAST_BURST_LIMIT)
    const seen = [...plan.toast, ...plan.overflow, ...plan.quiet].map((n) => n.id)
    expect(new Set(seen).size).toBe(burst.length)
  })

  it('does not mutate the input array', () => {
    const burst = [
      make('vehicle_arrived', 'info', { created_at: new Date(9000) }),
      make('vehicle_arrived', 'info', { created_at: new Date(1000) }),
    ]
    const order = burst.map((n) => n.id)
    planToastBurst(burst, 3)
    expect(burst.map((n) => n.id)).toEqual(order)
  })
})

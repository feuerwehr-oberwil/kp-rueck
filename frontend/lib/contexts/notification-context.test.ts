import { describe, expect, it } from 'vitest'
import type { Notification } from '@/lib/types/notification'
import { reconcileNotifications } from './notification-context'
import { UNSET_NOTIFICATION_FIELDS } from '@/test-utils/notification-fixtures'

const row = (id: string, overrides: Partial<Notification> = {}): Notification => ({
  ...UNSET_NOTIFICATION_FIELDS,
  id,
  type: 'field_message',
  severity: 'info',
  message: `Meldung ${id}`,
  params: { text: id },
  incident_id: 'inc-1',
  created_at: new Date('2026-10-23T18:00:00Z'),
  dismissed: false,
  ...overrides,
})

describe('reconcileNotifications', () => {
  it('hands back the same array when a poll learned nothing', () => {
    const prev = [row('a'), row('b')]
    expect(reconcileNotifications(prev, [row('a'), row('b')])).toBe(prev)
  })

  it('keeps the unchanged rows and takes the changed one', () => {
    const prev = [row('a'), row('b')]
    const next = reconcileNotifications(prev, [row('a'), row('b', { params: { text: 'neu' } })])
    expect(next).not.toBe(prev)
    expect(next[0]).toBe(prev[0])
    expect(next[1].params).toEqual({ text: 'neu' })
  })

  it('notices a dismissal, a new row and a new order', () => {
    const prev = [row('a'), row('b')]
    expect(reconcileNotifications(prev, [row('a', { dismissed: true }), row('b')])).not.toBe(prev)
    expect(reconcileNotifications(prev, [row('a'), row('b'), row('c')])).toHaveLength(3)
    const swapped = reconcileNotifications(prev, [row('b'), row('a')])
    expect(swapped).toEqual([prev[1], prev[0]])
    expect(swapped).not.toBe(prev)
  })

  it('takes a row whose version changed under the same text', () => {
    // A dismissal sends the version on screen; a stale one is refused again and again.
    const prev = [row('a')]
    const next = reconcileNotifications(prev, [row('a', { version: 'v2' })])
    expect(next[0].version).toBe('v2')
  })
})

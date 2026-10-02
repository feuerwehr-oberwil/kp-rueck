/**
 * A toast lives as long as it takes to read it (KP Front's curve), with the
 * «Anzeigedauer» setting scaling that curve instead of replacing it.
 */
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

const recorded = vi.hoisted(() => [] as Array<{ kind: string; data: Record<string, unknown> | undefined }>)
vi.mock('sonner', () => {
  const record = (kind: string) => (_message: unknown, data?: Record<string, unknown>) => {
    recorded.push({ kind, data })
    return kind
  }
  const toast = Object.assign(record('bare'), {
    success: record('success'),
    info: record('info'),
    warning: record('warning'),
    error: record('error'),
    message: record('message'),
    loading: record('loading'),
  })
  return { toast }
})

import { toast } from 'sonner'
import {
  TOAST_TIMED_CLASS,
  installToastLifetime,
  setToastDurationSetting,
  toastDurationMs,
  toastLifetime,
  toastText,
} from './toast-lifetime'

const chars = (n: number) => 'x'.repeat(n)

describe('toastDurationMs', () => {
  it('keeps short feedback at the 2.8 s floor', () => {
    expect(toastDurationMs('Gespeichert')).toBe(2800)
    expect(toastDurationMs('')).toBe(2800)
  })

  it('grows by 45 ms per character above the floor', () => {
    // 1800 + 45·40 = 3600
    expect(toastDurationMs(chars(40))).toBe(3600)
    // counts characters, not UTF-16 units
    expect(toastDurationMs('ü'.repeat(40))).toBe(3600)
  })

  it('caps at 10 s', () => {
    expect(toastDurationMs(chars(500))).toBe(10_000)
  })

  it('gives a toast with a button at least 6 s', () => {
    expect(toastDurationMs('Mannschaft gelöst', { hasAction: true })).toBe(6000)
    // long enough to pass the floor on its own
    expect(toastDurationMs(chars(120), { hasAction: true })).toBe(1800 + 45 * 120)
  })

  it('scales by the setting, 8 s being 1×', () => {
    expect(toastDurationMs(chars(40), { settingSeconds: 16 })).toBe(7200)
    expect(toastDurationMs(chars(500), { settingSeconds: 16 })).toBe(20_000)
    expect(toastDurationMs(chars(120), { settingSeconds: 4 })).toBe(3600)
  })

  it('never lets a short setting go below the floors', () => {
    expect(toastDurationMs(chars(40), { settingSeconds: 2 })).toBe(2800)
    expect(toastDurationMs(chars(40), { hasAction: true, settingSeconds: 2 })).toBe(6000)
  })

  it('treats a missing or broken setting as the default', () => {
    expect(toastDurationMs(chars(40), { settingSeconds: Number.NaN })).toBe(3600)
    expect(toastDurationMs(chars(40), { settingSeconds: 0 })).toBe(3600)
  })
})

describe('toastText', () => {
  it('reads strings, numbers, arrays and the text inside elements', () => {
    expect(toastText('Hallo')).toBe('Hallo')
    expect(toastText(42)).toBe('42')
    expect(toastText(['a', 1, null, false])).toBe('a1')
    expect(toastText(createElement('button', null, 'Hauptstrasse 1: ', createElement('b', null, 'Baum')))).toBe(
      'Hauptstrasse 1: Baum',
    )
    expect(toastText(() => 'lazy')).toBe('lazy')
  })
})

describe('toastLifetime', () => {
  it('carries the duration, the line class and its length', () => {
    expect(toastLifetime(8000, { className: 'mine', style: { color: 'red' } })).toEqual({
      duration: 8000,
      className: `mine ${TOAST_TIMED_CLASS}`,
      style: { color: 'red', '--toast-life': '8000ms' },
    })
  })

  it('draws no line under a sticky toast', () => {
    expect(toastLifetime(Infinity)).toEqual({ duration: Infinity })
  })
})

describe('installToastLifetime', () => {
  installToastLifetime()
  installToastLifetime() // idempotent: a second install must not wrap twice

  it('fills in the length-based duration and the line', () => {
    recorded.length = 0
    toast.success('Gespeichert')
    expect(recorded).toEqual([
      {
        kind: 'success',
        data: { duration: 2800, className: TOAST_TIMED_CLASS, style: { '--toast-life': '2800ms' } },
      },
    ])
  })

  it('counts the description and honours the action floor', () => {
    recorded.length = 0
    toast.error('Status konnte nicht geändert werden', { action: { label: 'Erneut versuchen', onClick: () => {} } })
    expect(recorded[0].data?.duration).toBe(6000)
    recorded.length = 0
    toast.info(chars(40), { description: chars(40) })
    // 81 characters with the joining space: 1800 + 45·81
    expect(recorded[0].data?.duration).toBe(1800 + 45 * 81)
  })

  it('leaves an explicit duration alone (and unscaled)', () => {
    setToastDurationSetting(30)
    recorded.length = 0
    toast.success('Aktualisiert', { duration: 1500 })
    toast.error('Verbindung verloren', { duration: Infinity })
    expect(recorded[0].data?.duration).toBe(1500)
    expect(recorded[1].data).toEqual({ duration: Infinity })
    setToastDurationSetting(8)
  })

  it('applies the setting it was last given', () => {
    setToastDurationSetting(16)
    recorded.length = 0
    toast.warning(chars(40))
    expect(recorded[0].data?.duration).toBe(7200)
    setToastDurationSetting(8)
  })

  it('does not touch loading toasts (they have no timer)', () => {
    recorded.length = 0
    toast.loading('Wird geladen …')
    expect(recorded[0].data).toBeUndefined()
  })
})

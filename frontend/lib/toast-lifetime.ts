/**
 * How long a toast stays — by how much there is to read, not one number for all.
 *
 * Every toast used to stand for the same 8 s (the notification setting doubled as
 * sonner's default): «Gespeichert» sat on the board as long as a three-line field
 * message, and the field message vanished as fast as «Gespeichert». The rule is
 * KP Front's (`lib/ui.tsx · defaultToastDuration`): 1800 ms plus 45 ms per
 * character, at least 2.8 s — or 6 s when there is a button to press («Rückgängig»,
 * «Erneut versuchen»: nobody reaches for a button in under six seconds) — and at
 * most 10 s. A failure (`toast.error`) gets the 6 s floor too, button or not: a
 * «konnte nicht …» that is gone in 3.4 s is a failure nobody saw.
 *
 * Rück's «Anzeigedauer» setting stays and keeps meaning «longer» or «shorter»: it
 * SCALES that curve, with its default of 8 s as 1×. 16 s gives every toast twice
 * its time, 4 s half — but never below the floors, so a short setting cannot take
 * the undo window away. A plain minimum would have flattened the curve again (at
 * the default 8 s every toast would be 8 s, exactly what this replaces).
 *
 * A caller's explicit `duration` still wins and is not scaled: whoever wrote
 * `duration: Infinity` or `duration: 1500` decided on purpose.
 */
import type { ReactNode } from 'react'
import { isValidElement } from 'react'
import { toast, type ExternalToast } from 'sonner'

export const TOAST_MIN_MS = 2800
export const TOAST_ACTION_MIN_MS = 6000
export const TOAST_MAX_MS = 10_000
/** The setting's default (`DEFAULT_NOTIFICATION_SETTINGS.toast_duration_seconds`) — scale 1×. */
export const TOAST_SETTING_BASE_SECONDS = 8

/** Class that draws the running-out line (globals.css · «Toast lane»). */
export const TOAST_TIMED_CLASS = 'toast-timed'

export function toastDurationMs(
  text: string,
  {
    hasAction = false,
    isFailure = false,
    settingSeconds = TOAST_SETTING_BASE_SECONDS,
  }: { hasAction?: boolean; isFailure?: boolean; settingSeconds?: number } = {},
): number {
  const floor = hasAction || isFailure ? TOAST_ACTION_MIN_MS : TOAST_MIN_MS
  const byLength = Math.min(TOAST_MAX_MS, Math.max(floor, 1800 + Array.from(text).length * 45))
  const seconds = Number.isFinite(settingSeconds) && settingSeconds > 0 ? settingSeconds : TOAST_SETTING_BASE_SECONDS
  return Math.max(floor, Math.round((byLength * seconds) / TOAST_SETTING_BASE_SECONDS))
}

/** The readable text of a title/description — strings, numbers, and the text inside elements. */
export function toastText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'function') return toastText((node as () => ReactNode)())
  if (Array.isArray(node)) return node.map(toastText).join('')
  if (isValidElement(node)) return toastText((node.props as { children?: ReactNode }).children)
  return ''
}

/**
 * `duration` plus what draws the line under the toast, for a toast that goes away
 * by itself. Infinity (sticky) gets neither the line nor a class.
 */
export function toastLifetime(ms: number, data?: ExternalToast): ExternalToast {
  if (!Number.isFinite(ms)) return { duration: ms }
  return {
    duration: ms,
    className: [data?.className, TOAST_TIMED_CLASS].filter(Boolean).join(' '),
    style: { ...data?.style, ['--toast-life' as string]: `${ms}ms` },
  }
}

let settingSeconds = TOAST_SETTING_BASE_SECONDS

/** Fed from the notification settings (NotificationToasts) whenever they change. */
export function setToastDurationSetting(seconds: number) {
  settingSeconds = seconds
}

function withLifetime(kind: string, message: unknown, data?: ExternalToast): ExternalToast {
  const hasAction = data?.action != null || data?.cancel != null
  const ms =
    data?.duration ??
    toastDurationMs(`${toastText(message)} ${toastText(data?.description)}`.trim(), {
      hasAction,
      isFailure: kind === 'error',
      settingSeconds,
    })
  return { ...data, ...toastLifetime(ms, data) }
}

type ToastFn = (message: ReactNode | (() => ReactNode), data?: ExternalToast) => string | number
const INSTALLED = Symbol.for('kp-rueck.toast-lifetime')
const TIMED_KINDS = ['success', 'info', 'warning', 'error', 'message'] as const

/**
 * Give every `toast.success/info/warning/error/message` its length-based lifetime.
 *
 * A wrapper on sonner's own object rather than a house `toast` module: ~350 call
 * sites import `toast` from 'sonner', and rewriting every import (plus a lint rule
 * to keep it that way) for one default is churn, not design. Same technique the
 * quiet-surface muting in NotificationToasts already uses — and it composes with
 * it: that effect saves and restores whatever is installed, i.e. these wrappers.
 * Bare `toast()` cannot be wrapped (sonner binds it internally); its callers
 * pass `toastLifetime(…)` themselves. Idempotent across HMR.
 */
export function installToastLifetime() {
  const target = toast as unknown as Record<string | symbol, unknown>
  if (target[INSTALLED]) return
  target[INSTALLED] = true
  for (const kind of TIMED_KINDS) {
    const original = target[kind] as ToastFn
    target[kind] = ((message, data) => original(message, withLifetime(kind, message, data))) as ToastFn
  }
}

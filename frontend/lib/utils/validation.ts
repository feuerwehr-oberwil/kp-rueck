const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isValidUUID = (id: string | undefined | null): id is string => {
  if (!id) return false
  return UUID_REGEX.test(id)
}

/**
 * A random id that is safe to call anywhere.
 *
 * `crypto.randomUUID` is only exposed in SECURE CONTEXTS — HTTPS or localhost.
 * On an on-prem install served over plain HTTP from a LAN address
 * (http://10.10.10.x:3000) it is `undefined`, and calling it throws. These ids
 * are only ever local placeholders for optimistic UI, never persisted and
 * never security-relevant, so a non-crypto fallback is fine; crashing the
 * mutation that needed one is not.
 */
export const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

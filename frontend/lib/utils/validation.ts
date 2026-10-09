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

/**
 * A real RFC 4122 v4 UUID, also on a plain-HTTP LAN install.
 *
 * Unlike `randomId` this one is SENT to the backend (R13: the phone's own id
 * for a request, so «Nochmals senden» is recognised as a repeat), and the
 * backend validates the shape. `crypto.getRandomValues` — unlike
 * `crypto.randomUUID` — exists outside secure contexts too.
 */
export const randomUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

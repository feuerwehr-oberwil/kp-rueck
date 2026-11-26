import { isRecord } from '@/lib/utils/safe-storage'

/**
 * The claims of a link token, decoded WITHOUT verifying the signature: for routing and for
 * naming local state only (which screen to skip, whose draft this is). The server checks
 * the token on every request, so a forged payload buys nothing. Null for anything that is
 * not a readable JWT.
 *
 *   const claims = decodeJwtPayload(token)
 *   if (claims?.type === 'feld') …
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segment = token.split('.')[1]
  if (!segment) return null
  try {
    const payload: unknown = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')))
    return isRecord(payload) ? payload : null
  } catch {
    return null
  }
}

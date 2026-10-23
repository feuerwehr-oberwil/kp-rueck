/**
 * The three moves the `/feld` pages make on `document.cookie`: read one value,
 * write one for some days on one path, clear it on that path.
 *
 * Values go in and come out exactly as stored – no encoding here, because the
 * callers differ on purpose: the `/feld` tokens and ids are cookie-safe as they
 * are, the name cookie (`feld-identity-bar`) holds free text and encodes it
 * itself. A cookie must be cleared on the same `path` it was written on, or the
 * browser keeps it – so a caller passes the same scope to both.
 */

/** Where a cookie lives and how long: `path` scopes it, `days` is its lifetime. */
export type CookieScope = { path: string; days: number }

/** The raw value of `name`, or null when it is not set (or there is no document). */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? match[2] : null
}

export function writeCookie(name: string, value: string, { path, days }: CookieScope) {
  const expires = new Date()
  expires.setDate(expires.getDate() + days)
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=${path}`
}

export function clearCookie(name: string, { path }: Pick<CookieScope, 'path'>) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${path}`
}

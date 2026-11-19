/**
 * `raw` if it is a path on THIS site, else null – for a return path that arrived in a URL
 * (`return_to`), so a crafted link can never send a phone on to somewhere else.
 *
 * `//host` and `/\host` are other sites to a browser (protocol-relative; a backslash counts as
 * a slash), so a single leading slash is not enough.
 */
export function ownPath(raw: string | null | undefined): string | null {
  if (!raw?.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

/** `link` (a path on this site) with `return_to` set to `back`: the way home after the page. */
export function withReturnTo(link: string, back: string): string {
  const url = new URL(link, 'https://same.origin')
  url.searchParams.set('return_to', back)
  return `${url.pathname}${url.search}`
}

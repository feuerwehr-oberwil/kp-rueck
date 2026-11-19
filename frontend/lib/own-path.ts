/** A stand-in origin: only «does it stay on it» matters, never which one it is. */
const HERE = 'https://own.origin'

/**
 * `raw` as a path on THIS site, else null – for a return path that arrived in a URL
 * (`return_to`), so a crafted link can never send a phone on to somewhere else.
 *
 * Resolved the way the browser will resolve it, not compared as a string: `//host`, `/\host`
 * `/<tab>/host` (the URL parser drops tabs and newlines) and `/a/..//host` all leave the site. The answer is
 * the resolved path, so what is navigated to is exactly what was checked.
 */
export function ownPath(raw: string | null | undefined): string | null {
  if (!raw?.startsWith('/')) return null
  let url: URL
  try {
    url = new URL(raw, HERE)
  } catch {
    return null
  }
  // `/a/..//host` resolves on this origin to the path `//host` – which the router reads as
  // another site again.
  if (url.origin !== HERE || url.pathname.startsWith('//')) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** `link` (a path on this site) with `return_to` set to `back`: the way home after the page. */
export function withReturnTo(link: string, back: string): string {
  const url = new URL(link, HERE)
  url.searchParams.set('return_to', back)
  return `${url.pathname}${url.search}`
}

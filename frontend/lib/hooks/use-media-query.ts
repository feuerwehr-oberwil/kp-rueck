'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * The one media-query hook: «does `query` match right now?», re-rendering when it flips.
 *
 * `useSyncExternalStore` keeps one source of truth – the snapshot reads the same
 * `matchMedia(query)` the subscription listens to (the bug `useIsMobile` had until
 * 2026-10-20 was answering from `innerWidth` while listening to a query) – and gives a
 * component mounted after hydration the real answer on its first render.
 *
 * - `serverDefault` answers on the server, and therefore for the hydrating render too
 *   (React reuses the server snapshot there, which is what keeps hydration matching).
 * - `withoutMatchMedia` answers where `matchMedia` is missing (jsdom, very old
 *   WebViews); the hook must not throw there. Defaults to `serverDefault`.
 *
 * Callers name the question in a one-line hook (`useIsMobile`, `usePointerFine`, …) so
 * the query string and its fallbacks live in one place each.
 */
export function useMediaQuery(
  query: string,
  serverDefault: boolean,
  withoutMatchMedia: () => boolean = () => serverDefault,
): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  const getSnapshot = () =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : withoutMatchMedia()
  return useSyncExternalStore(subscribe, getSnapshot, () => serverDefault)
}

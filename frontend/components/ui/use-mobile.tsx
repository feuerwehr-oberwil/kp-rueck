import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * One matchMedia subscription shared by every caller, rather than one per
 * component: `useSyncExternalStore` dedupes the listener, and ~20 consumers ask
 * this question — `useStackedFields` means every form field is one of them.
 *
 * No matchMedia (jsdom, very old WebViews): nothing to subscribe to, so the
 * width is read on each render instead. The hook must not throw where the API
 * is missing.
 */
function subscribe(onStoreChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onStoreChange)
  return () => mql.removeEventListener('change', onStoreChange)
}

const getSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT

/**
 * The server has no viewport, so it answers «desktop» — and React reuses THIS
 * snapshot for the hydrating render too, which is what keeps hydration from
 * mismatching.
 */
const getServerSnapshot = () => false

/**
 * Is the viewport narrower than the `md` breakpoint?
 *
 * Previously this started at `undefined` and settled in an effect, so it
 * returned `false` on every first render — not just while hydrating, where it
 * has to, but also for a component mounted long afterwards by a client
 * navigation, where the width is sitting right there to be read. On a tablet
 * that meant the desktop branch painted and then flipped, on every navigation.
 * `useSyncExternalStore` keeps the hydration-safe answer for the hydrating
 * render and gives every later mount the real one immediately.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

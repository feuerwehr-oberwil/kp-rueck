import { useMediaQuery } from '@/lib/hooks/use-media-query'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/** No matchMedia (jsdom, very old WebViews): the width is read on each render instead. */
const widthIsMobile = () => window.innerWidth < MOBILE_BREAKPOINT

/**
 * Is the viewport narrower than the `md` breakpoint? ~20 consumers ask this –
 * `useStackedFields` makes every form field one of them – over one shared
 * subscription. The server answers «desktop» (and so does the hydrating render);
 * every later mount gets the real answer on its first render.
 */
export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY, false, widthIsMobile)
}

/** The same question asked once, outside render – for a redirect that must not act on the
 *  hydrating render's «desktop» (`ProtectedRoute`, the login's landing). Client only. */
export function isMobileViewport() {
  return typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY).matches : widthIsMobile()
}

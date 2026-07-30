import { NextResponse } from 'next/server'

import { buildContentSecurityPolicy } from '@/lib/env'

/**
 * The Content-Security-Policy, composed per request.
 *
 * It used to be built in `next.config.mjs` `headers()`, which Next serialises into the route
 * manifest at build time — so `connect-src` could only name what was known when the image was
 * built, and its backend entry came from `NEXT_PUBLIC_API_URL`. The published GHCR images are
 * built *without* that variable on purpose (baking a URL in ties one image to one station), so
 * a split-origin deployment on a custom backend domain had a socket aimed at the right host and
 * a browser that refused to connect. Here the runtime `API_URL` is available, which is the whole
 * point: `connect-src` names this deployment's backend, not the build machine's guess.
 *
 * Only the CSP moved. The other security headers are static, and staying in `next.config.mjs`
 * keeps them on *every* response — including `_next/static`, which this matcher skips.
 *
 * Edge runtime: everything imported here must be Edge-safe. `lib/env.ts` has no imports at all
 * and uses only `URL`.
 *
 * The `/backend-api` proxy route deliberately keeps its Node runtime and is excluded below —
 * see `app/backend-api/[...path]/route.ts`.
 */
export const config = {
  // Documents get the CSP; nothing else needs it. Excluded: Next's own static output, the
  // `/backend-api` proxy (a CSP on a JSON response governs nothing, and the board polls it),
  // and anything with a file extension (`/icon.svg`, `/placeholder.jpg`, the public folder).
  // Everything else — every page, including ones added later — is covered by default, because
  // a CSP with an invisible hole is worse than one that is simply absent.
  matcher: [
    '/((?!_next/static|_next/image|backend-api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json|webmanifest)$).*)',
  ],
}

export function middleware() {
  const response = NextResponse.next()

  response.headers.set(
    'Content-Security-Policy',
    buildContentSecurityPolicy({
      // Runtime — the variable the `/backend-api` proxy already reads on every request.
      apiUrl: process.env.API_URL,
      // Build-time overrides, still honoured for a station that builds its own image.
      publicApiUrl: process.env.NEXT_PUBLIC_API_URL,
      publicWsUrl: process.env.NEXT_PUBLIC_WS_URL,
      isProduction: process.env.NODE_ENV === 'production',
    }),
  )

  return response
}

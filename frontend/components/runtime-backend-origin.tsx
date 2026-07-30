'use client'

import { setRuntimeBackendOrigin } from '@/lib/env'

/**
 * Carries the server's runtime `API_URL` into the browser bundle.
 *
 * The WebSocket cannot go through the `/backend-api` proxy route (API routes speak HTTP,
 * not socket upgrades), so on a split-origin deployment the browser has to name the backend
 * host itself — and until now it could only *guess* it, because `API_URL` is read at
 * runtime by the server and `NEXT_PUBLIC_*` is inlined at build time. A Railway install on
 * a custom domain lost every guess and fell back to same-origin, where nothing listens: no
 * socket, no error, five-second polling. This is the missing channel.
 *
 * A prop rather than a `NEXT_PUBLIC_*` variable on purpose: the value must stay per
 * deployment, and the root layout renders dynamically on every request (next-intl reads the
 * `NEXT_LOCALE` cookie), so `process.env.API_URL` here is genuinely read at request time.
 *
 * Set during render, not in an effect: effects run after the whole tree has rendered, and
 * `OperationsProvider` opens the socket in one of them.
 */
export function RuntimeBackendOrigin({ origin }: { origin: string | null }) {
  setRuntimeBackendOrigin(origin)
  return null
}

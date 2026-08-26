'use client'

import { setRuntimeBackendOrigin, setRuntimeCartoApiKey } from '@/lib/env'

/**
 * Carries server-side runtime configuration into the browser bundle.
 *
 * The WebSocket cannot go through the `/backend-api` proxy route (API routes speak HTTP,
 * not socket upgrades), so on a split-origin deployment the browser has to name the backend
 * host itself — and until now it could only *guess* it, because `API_URL` is read at
 * runtime by the server and `NEXT_PUBLIC_*` is inlined at build time. A Railway install on
 * a custom domain lost every guess and fell back to same-origin, where nothing listens: no
 * socket, no error, five-second polling. This is the missing channel.
 *
 * Props rather than `NEXT_PUBLIC_*` variables on purpose: the values must stay per deployment,
 * and the root layout renders dynamically on every request (next-intl reads the `NEXT_LOCALE`
 * cookie), so `process.env` here is genuinely read at request time. The CARTO key is public to
 * the tile client by design, but must not be committed or baked into the shared image.
 *
 * Set during render, not in an effect: effects run after the whole tree has rendered, and
 * `OperationsProvider` opens the socket in one of them.
 */
export function RuntimeBackendOrigin({
  origin,
  cartoApiKey,
}: {
  origin: string | null
  cartoApiKey: string | null
}) {
  setRuntimeBackendOrigin(origin)
  setRuntimeCartoApiKey(cartoApiKey)
  return null
}

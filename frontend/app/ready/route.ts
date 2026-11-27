import { NextResponse } from 'next/server'

/**
 * Is the whole stack up – this server, the backend and its database? 200 `{ ready: true }` or
 * 503 `{ ready: false }`.
 *
 * The wake page in front of the sleeping public demo (kp-rueck.ch/demo/, `site/demo.template.html`)
 * polls it and opens the demo on the first 200. One request proves all three: it reaches this
 * server, which asks the backend's `/health`, which runs `SELECT 1`. On Railway Serverless that
 * same request is what wakes the backend, and the backend's connection wakes Postgres.
 *
 * Public and CORS-open on purpose: the page lives on another origin, and the answer is one
 * boolean that `/health` already gives anyone – no cookies are read or sent.
 */
export const dynamic = 'force-dynamic'

/** Shorter than a cold boot: the page retries, and the held request keeps the boot going. */
const BACKEND_TIMEOUT_MS = 8000

const HEADERS = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }

export async function GET() {
  const backendUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL
  let ready = false
  if (backendUrl) {
    try {
      const response = await fetch(`${backendUrl}/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      })
      ready = response.ok
      await response.body?.cancel()
    } catch {
      // Not up yet (refused, held past the timeout, or a 502 from the edge): not ready.
    }
  }
  return NextResponse.json({ ready }, { status: ready ? 200 : 503, headers: HEADERS })
}

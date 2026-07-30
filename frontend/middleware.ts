import { NextResponse } from 'next/server'

/**
 * Middleware is disabled - using API routes instead for /backend-api
 *
 * API routes run on Node.js runtime which handles cookies more reliably
 * than Edge middleware. See: app/backend-api/[...path]/route.ts
 */
export const config = {
  matcher: [],  // Empty matcher - middleware won't run for any routes
}

export async function middleware() {
  return NextResponse.next()
}

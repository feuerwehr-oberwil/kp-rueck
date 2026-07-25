'use client'

import { useEffect } from 'react'

import { installGlobalErrorReporting } from '@/lib/report-error'

/**
 * Installs the window-level error listeners, once, for the whole app.
 *
 * Mounted in the root layout because the errors worth catching are exactly the ones that
 * happen outside the React tree — a rejected promise in a polling hook, a listener that
 * throws on a WebSocket message. `app/error.tsx` and `app/global-error.tsx` cover the render
 * path; this covers everything else.
 *
 * Renders nothing and never suspends: if this component is the thing that breaks, it takes
 * the whole layout with it, so it does as close to nothing as a component can.
 */
export function ErrorReporter() {
  useEffect(() => {
    installGlobalErrorReporting()
  }, [])
  return null
}

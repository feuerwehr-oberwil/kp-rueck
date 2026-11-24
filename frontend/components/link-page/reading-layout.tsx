import type { Viewport } from 'next'
import type { ReactNode } from 'react'

/** The board's viewport (lib/zoom-lock.ts) with the pinch zoom given back: safe areas on too. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: undefined,
  userScalable: true,
  viewportFit: 'cover',
}

/** A marker, so sheets portalled to the body allow the same native zoom as their form. */
export default function ReadingLayout({ children }: { children: ReactNode }) {
  return <><span hidden data-page-zoom="" />{children}</>
}

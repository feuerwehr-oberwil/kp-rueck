import type { Viewport } from 'next'
import type { ReactNode } from 'react'

export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: undefined, userScalable: true }

/** A marker, so sheets portalled to the body allow the same native zoom as their form. */
export default function ReadingLayout({ children }: { children: ReactNode }) {
  return <><span hidden data-page-zoom="" />{children}</>
}

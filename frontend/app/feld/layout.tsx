import type { Viewport } from 'next'

import { FeldNoZoom } from '@/components/feld/feld-no-zoom'

/**
 * `/feld` is a phone surface laid out for the phone: pinch or double-tap zoom only ever gets a
 * crew stuck in a magnified, half-off-screen page (owner, 03.10., in the home-screen app). So for
 * these routes — and only these; the board keeps zoom — the viewport is fixed at 1.
 *
 * `maximumScale: 1` also stops iOS auto-zooming into a focused field, which it does for any
 * input under 16px; the inputs here are 16px anyway (`FeldNoZoom` pins that). iOS ignores
 * `userScalable: false` for pinch in Safari since iOS 10, hence the touch-action + gesture guard
 * in `FeldNoZoom`. The themeColor of the root layout is inherited (viewport fields merge).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function FeldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <FeldNoZoom />
      {children}
    </>
  )
}

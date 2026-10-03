import type { Viewport } from 'next'

/**
 * The viewport of the «Links & QR» pages (/feld, /check-in, /reko, /alarm): fixed at scale 1.
 * `maximumScale: 1` is also what stops iOS zooming into a focused field. A plain module, not the
 * client one next to `LinkPageNoZoom`: a route's `viewport` export is read on the server, and a
 * value imported from a 'use client' file arrives there as a client reference, not an object.
 */
export const LINK_PAGE_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

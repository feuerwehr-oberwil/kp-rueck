import type { ReactNode } from 'react'

import { LinkPageNoZoom } from '@/components/link-page/link-page'

/**
 * The route layout every «Links & QR» page shares (/feld, /check-in, /reko, /alarm): the zoom
 * guard for as long as the route is mounted. The route files re-export it together with
 * `LINK_PAGE_VIEWPORT` (lib/link-page-viewport.ts) as their `viewport`.
 */
export default function LinkPageLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LinkPageNoZoom />
      {children}
    </>
  )
}

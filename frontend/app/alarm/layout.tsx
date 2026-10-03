import { LinkPageNoZoom } from '@/components/link-page/link-page'
import { LINK_PAGE_VIEWPORT } from '@/lib/link-page-viewport'

/**
 * A «Links & QR» page: laid out for the phone, so no pinch / double-tap / focus zoom — for this
 * route only, the board keeps its zoom. The frame is shared (components/link-page/link-page.tsx);
 * the root layout's theme-color is untouched (viewport fields merge).
 */
export const viewport = LINK_PAGE_VIEWPORT

export default function LinkPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LinkPageNoZoom />
      {children}
    </>
  )
}

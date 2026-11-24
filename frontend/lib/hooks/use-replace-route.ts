'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * «This page is not where you belong – go to `href`», for a page that decides it during
 * render: `href` is the address to replace this one with, `null` while it stays. The history
 * entry is replaced, so «zurück» does not land back here and bounce again.
 *
 * Used by the display chrome (no login, no token → the front door) and the QR viewer link's
 * phone landing (`/display?token=…` → its board, app/display/page.tsx).
 */
export function useReplaceRoute(href: string | null) {
  const router = useRouter()
  useEffect(() => {
    if (href !== null) router.replace(href)
  }, [href, router])
}

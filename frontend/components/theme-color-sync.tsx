'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'

import { applyThemeColor } from '@/lib/theme-color'

/**
 * Keeps the system bar colour (`theme-color`) on the scheme the app shows — see lib/theme-color.
 * Re-applied on navigation as well: Next re-renders the head's viewport tags when a segment with
 * its own `viewport` export (/feld) comes or goes, which puts the system-scheme values back.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme()
  const pathname = usePathname()
  useEffect(() => {
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') applyThemeColor(resolvedTheme)
  }, [resolvedTheme, pathname])
  return null
}

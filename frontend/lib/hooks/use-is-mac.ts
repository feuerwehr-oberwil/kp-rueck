'use client'

import { useEffect, useState } from 'react'

/**
 * True on macOS/iPadOS, where the command palette modifier is ⌘.
 * Everywhere else (Windows, Linux) the modifier is Ctrl.
 *
 * Starts `false` so the server render and first client render agree
 * (avoiding a hydration mismatch); flips to `true` after mount on Mac.
 */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false)

  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      ''
    setIsMac(/mac/i.test(platform))
  }, [])

  return isMac
}

/** The command-palette modifier label for the current platform ("⌘K" / "Ctrl K"). */
export function useCommandPaletteHint(): string {
  return useIsMac() ? '⌘K' : 'Ctrl K'
}

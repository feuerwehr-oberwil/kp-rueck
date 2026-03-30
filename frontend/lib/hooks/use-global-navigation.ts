"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * Global g-prefix keyboard navigation (g+k → kanban, g+m → map, g+e → events).
 * Mount this on any page to enable cross-page navigation shortcuts.
 */
export function useGlobalNavigation() {
  const router = useRouter()
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea or inside a dialog/modal
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.closest('[role="dialog"]')
      ) {
        return
      }

      // Esc cancels g-prefix mode
      if (e.key === 'Escape' && gPrefixActive) {
        setGPrefixActive(false)
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
          gPrefixTimeoutRef.current = null
        }
        return
      }

      // Handle g-prefix navigation
      if (gPrefixActive) {
        e.preventDefault()
        setGPrefixActive(false)
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
          gPrefixTimeoutRef.current = null
        }

        if (e.key === 'k' || e.key === 'K') {
          router.push('/')
        } else if (e.key === 'm' || e.key === 'M') {
          router.push('/map')
        } else if (e.key === 'e' || e.key === 'E') {
          router.push('/events')
        } else if (e.key === 's' || e.key === 'S') {
          router.push('/settings')
        } else if (e.key === 'h' || e.key === 'H') {
          router.push('/help')
        }
        return
      }

      // Activate g-prefix mode
      if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setGPrefixActive(true)
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
        }
        gPrefixTimeoutRef.current = setTimeout(() => {
          setGPrefixActive(false)
          gPrefixTimeoutRef.current = null
        }, 1500)
        return
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      if (gPrefixTimeoutRef.current) {
        clearTimeout(gPrefixTimeoutRef.current)
      }
    }
  }, [gPrefixActive, router])

  return { gPrefixActive, setGPrefixActive, gPrefixTimeoutRef }
}

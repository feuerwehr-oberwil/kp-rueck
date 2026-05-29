"use client"

import { useEffect, useState } from "react"

export interface UseCurrentTime {
  /** The latest tick; null until the component mounts (SSR-safe). */
  currentTime: Date | null
  /** True once the first tick has fired — useful for gating SSR-vs-CSR text. */
  isMounted: boolean
}

/**
 * Mounts a 1-second ticker that drives any always-fresh-clock UI in the
 * dashboard. Starts at `null` so server-rendered markup matches the
 * client's first paint, then bumps on mount.
 */
export function useCurrentTime(intervalMs = 1000): UseCurrentTime {
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return { currentTime, isMounted }
}

import { useEffect, useState } from 'react'

/**
 * True once `active` has held for `ms` without a break; false again the moment it drops, and
 * the wait starts over the next time it holds. A just-pinned map card keeps its side until a
 * double-click can no longer land (components/map/incident-label.tsx, `useCardSide`).
 */
export function useSettledAfter(active: boolean, ms: number): boolean {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSettled(true), ms)
    return () => {
      clearTimeout(timer)
      setSettled(false)
    }
  }, [active, ms])
  return active && settled
}

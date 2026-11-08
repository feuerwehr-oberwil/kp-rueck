"use client"

import { useEffect, useState } from "react"

/** How long the wall waits, without a mouse move or a key, before its idle chrome fades (owner pick U5 B). */
export const WALL_IDLE_MS = 10_000

/**
 * True once nobody has moved the mouse, clicked or pressed a key for `timeoutMs`;
 * false again on the first such input. The wall's top bar uses it to fade the
 * controls nobody at 4 m reads (the back arrow and the search field) – in place,
 * so nothing else in the bar moves.
 *
 * Any key wakes it, «S» included, so the search shortcut brings the field back in
 * the same keystroke that focuses it.
 *
 * Usage: `const idle = useWallIdle()` → `className={cn(idle && "opacity-0")}`.
 */
export function useWallIdle(timeoutMs: number = WALL_IDLE_MS): boolean {
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), timeoutMs)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), timeoutMs)
    }
    const events = ["mousemove", "pointerdown", "keydown"] as const
    for (const type of events) window.addEventListener(type, wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const type of events) window.removeEventListener(type, wake)
    }
  }, [timeoutMs])

  return idle
}

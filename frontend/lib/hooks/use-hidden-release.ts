'use client'

import { useEffect } from 'react'
import { useEffectEvent } from './use-effect-event'

/**
 * Lets go of something a hidden tab holds: once the tab has been hidden for `afterMs`, `release`
 * runs; when that tab comes back to the front, `onReturn` runs. A shorter look away does
 * nothing. Off while `enabled` is false.
 *
 * The public demo uses it (components/demo-banner.tsx): a hidden tab's socket would keep the
 * sleeping demo awake for as long as the browser keeps the tab.
 *
 *   useHiddenRelease({ enabled: isDemo, afterMs: 10 * 60_000, release: drop, onReturn: reload })
 */
export function useHiddenRelease({
  enabled,
  afterMs,
  release,
  onReturn,
}: {
  enabled: boolean
  afterMs: number
  release: () => void
  onReturn: () => void
}): void {
  const releaseNow = useEffectEvent(release)
  const returned = useEffectEvent(onReturn)

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let released = false
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        timer ??= setTimeout(() => {
          released = true
          releaseNow()
        }, afterMs)
        return
      }
      clearTimeout(timer)
      timer = undefined
      if (released) {
        released = false
        returned()
      }
    }
    onVisibilityChange()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearTimeout(timer)
    }
  }, [enabled, afterMs])
}

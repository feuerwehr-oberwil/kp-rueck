"use client"

import { useEffect, useRef } from "react"

/**
 * The provider's `<audio>` element for the new-high-priority alert, primed on the
 * first user gesture so a later programmatic `.play()` is not blocked by the
 * browser's autoplay policy. The board load (`use-board-sync`) rings it.
 */
export function useAlertAudio() {
  const alertAudioRef = useRef<HTMLAudioElement | null>(null)
  // Browsers block .play() until the user has interacted with the page. Track
  // unlock state so we know whether the alert sound can actually fire and
  // retry without spamming the console.
  const alertAudioUnlockedRef = useRef<boolean>(false)

  // Prime the alert audio element on the first user gesture so subsequent
  // programmatic .play() calls aren't blocked by the browser autoplay policy.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const unlock = () => {
      const audio = alertAudioRef.current
      if (!audio) return
      audio.volume = 0.7
      const prime = audio.play()
      if (prime && typeof prime.then === 'function') {
        prime
          .then(() => {
            audio.pause()
            audio.currentTime = 0
            alertAudioUnlockedRef.current = true
          })
          .catch(() => {
            // Some browsers still refuse — leave unlocked=false; we'll retry on the next gesture.
          })
      } else {
        alertAudioUnlockedRef.current = true
      }
    }
    const opts: AddEventListenerOptions = { once: false, passive: true }
    const handler = () => {
      if (alertAudioUnlockedRef.current) return
      unlock()
    }
    window.addEventListener('pointerdown', handler, opts)
    window.addEventListener('keydown', handler, opts)
    window.addEventListener('touchstart', handler, opts)
    return () => {
      window.removeEventListener('pointerdown', handler, opts)
      window.removeEventListener('keydown', handler, opts)
      window.removeEventListener('touchstart', handler, opts)
    }
  }, [])

  return { alertAudioRef, alertAudioUnlockedRef }
}

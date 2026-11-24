'use client'

import { useEffect, useRef } from 'react'
import { useEffectEvent } from './use-effect-event'

/** The key our entries carry in `history.state` (beside Next's own `__NA` tree, which its patched
 *  `pushState` copies in). */
const LEVEL_KEY = 'kpLevel'
/** The levels on screen now – an entry with a level id not in here is left over from a reload. */
const live = new Set<string>()
let lastId = 0
function topLevel(): string | null {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null || !(LEVEL_KEY in state)) return null
  const id = (state as Record<typeof LEVEL_KEY, unknown>)[LEVEL_KEY]
  return typeof id === 'string' ? id : null
}

/**
 * One level of a page in the browser history: /alarm's «Stimmt das so?» over its form, a /feld
 * Schadenplatz over the list (phone sweep 24.11.2026). While `open`, the level stands on one
 * history entry of its own, so the native back – iOS's edge swipe, Android's back gesture, the
 * browser's ‹ – steps down to the page under it and calls `onBack`, instead of leaving the page.
 * Same idea as KP Front's `lib/historyTrail.ts`, for one level.
 *
 *   const back = useHistoryLevel(step === 'review', () => setStep('form'))
 *   <Button onClick={back}>Zurück</Button>   // the in-page «Zurück»: onBack now, and the entry
 *                                            // walked back, so the history matches the screen
 *
 * When the level closes some other way (sent, forgotten, the page left) while its entry is still
 * on top, the hook walks back over it, so no dead back press stays behind. An entry left over from
 * a reload is reused rather than stacked on. Not handled: Forward onto a closed level's entry shows
 * the level below (one dead back press), as does a reload on a level.
 */
export function useHistoryLevel(open: boolean, onBack: () => void): () => void {
  const leave = useEffectEvent(onBack)
  /** `at`: the entry this level stands on; `leaving`: the one a clean-up is about to walk back. */
  const level = useRef<{ at: string | null; leaving: string | null }>({ at: null, leaving: null })

  useEffect(() => {
    if (!open) return
    const top = topLevel()
    const remount = top !== null && top === level.current.leaving
    let id: string | null = null
    const onPop = () => {
      if (topLevel() !== id) leave()
    }
    /** Put the level on its own entry. */
    const stand = () => {
      if (id !== null) return
      if (remount && top !== null) {
        // StrictMode's dev remount: the clean-up just ran, its walk-back has not – stay on the entry.
        id = top
      } else {
        id = `level-${++lastId}`
        const leftOver = top !== null && !live.has(top)
        if (leftOver) window.history.replaceState({ [LEVEL_KEY]: id }, '')
        else window.history.pushState({ [LEVEL_KEY]: id }, '')
      }
      level.current = { at: id, leaving: null }
      live.add(id)
      window.addEventListener('popstate', onPop)
    }
    // Chromium skips back over an entry pushed before the page was ever touched (its history
    // manipulation intervention), so a level a restore opened on load would be a back that leaves
    // the page anyway. Such a level waits for the first touch or key – a user activation – and
    // lives in memory until then; `back()` works either way. (No `userActivation` – jsdom, an
    // old browser – stands at once.)
    const untouched = typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === false
    if (untouched && !remount) {
      level.current = { at: null, leaving: null }
      window.addEventListener('pointerup', stand, { capture: true })
      window.addEventListener('keydown', stand, { capture: true })
    } else {
      stand()
    }
    return () => {
      window.removeEventListener('pointerup', stand, { capture: true })
      window.removeEventListener('keydown', stand, { capture: true })
      window.removeEventListener('popstate', onPop)
      if (id === null) return
      const own = id
      live.delete(own)
      // `back()` below already walked; otherwise walk after the commit – a remount on the same
      // entry (above) cancels it.
      const walked = level.current.at !== own
      level.current = { at: null, leaving: walked ? null : own }
      if (walked) return
      queueMicrotask(() => {
        if (level.current.leaving !== own) return
        level.current.leaving = null
        if (topLevel() === own) window.history.back()
      })
    }
  }, [open])

  return () => {
    // Down at once; the history follows. Only our own entry is walked back – one that was never
    // pushed, or has something standing on it, is left alone: never off the page.
    if (level.current.at !== null && topLevel() === level.current.at) {
      level.current.at = null
      window.history.back()
    }
    onBack()
  }
}

/**
 * WebGL context recovery for the GL maps. Copied from KP Front (`src/lib/useGlRecovery.ts`).
 *
 * A browser reclaims the WebGL context under memory pressure and after a long spell in the
 * background – routine for a board left open on a wall display for a whole shift. MapLibre does
 * not rebuild itself when that happens: the canvas goes blank while every bit of surrounding
 * chrome keeps working, so it doesn't even READ as a crash. There is nothing to click, and the
 * only cure is reloading the page – which an operator has no reason to guess at.
 *
 * Recovery is a fresh map instance (a new canvas + new GL resources), which in react-map-gl means
 * remounting `<Map>` under a new key. Policy: heal SILENTLY the first time (the operator most
 * likely never sees it – the context died while nobody was looking), but if the context dies
 * again in short order, stop remounting and hand the operator an explicit action instead of
 * looping.
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Map as MlMap } from 'maplibre-gl'
import { reportClientError } from '@/lib/report-error'

/**
 * A second loss inside this window means auto-healing isn't working (the GPU keeps dropping us),
 * so we stop and ask. Losses further apart are unrelated events and each earn a heal.
 */
export const AUTO_HEAL_WINDOW_MS = 60_000

/** Pure policy: given when we last auto-healed, is another silent remount warranted? */
export function shouldAutoHeal(lastHealAt: number | null, now: number): boolean {
  return lastHealAt == null || now - lastHealAt > AUTO_HEAL_WINDOW_MS
}

export interface GlRecovery {
  /** Bump this into the `<Map>` key to build a fresh instance. */
  generation: number
  /** True once auto-healing has given up – render the manual recovery affordance. */
  lost: boolean
  /** Operator-triggered recovery (the affordance's action). */
  recover: () => void
}

/**
 * Watch `getMap()`'s canvas for context loss and drive recovery.
 *
 * `ready` should flip whenever a new map instance exists, so the listener re-attaches to the new
 * canvas. `onRecover` runs right before a remount so the caller can reset instance-scoped state.
 */
export function useGlRecovery(
  getMap: () => MlMap | null | undefined,
  ready: boolean,
  onRecover?: () => void,
): GlRecovery {
  const [generation, setGeneration] = useState(0)
  const [lost, setLost] = useState(false)
  const lastHealAt = useRef<number | null>(null)

  const remount = useCallback(() => {
    onRecover?.()
    setLost(false)
    setGeneration((n) => n + 1)
  }, [onRecover])

  const recover = useCallback(() => {
    lastHealAt.current = Date.now()
    remount()
  }, [remount])

  // The caller passes a fresh `getMap` closure each render; the effect reads the current one and
  // re-attaches only when a new canvas can exist (ready / generation).
  const currentCanvas = useEffectEvent(() => getMap()?.getCanvas())

  useEffect(() => {
    if (!ready) return
    // getCanvas() throws once MapLibre has torn itself down; this effect can re-run against a map
    // that is already going away (dialog close, tab teardown). A recovery mechanism must not
    // itself be a crash source.
    let canvas: HTMLCanvasElement | undefined
    try {
      canvas = currentCanvas()
    } catch {
      return
    }
    if (!canvas) return

    const onLost = (event: Event) => {
      // Deliberately NOT preventDefault(): that asks the browser to restore THIS context, but
      // MapLibre won't rebuild its GL resources into it, so the map would stay blank. We throw the
      // instance away and build a new one instead.
      reportClientError(new Error('WebGL context lost'), { kind: 'error' })
      event.stopPropagation()
      if (shouldAutoHeal(lastHealAt.current, Date.now())) {
        lastHealAt.current = Date.now()
        remount()
      } else {
        setLost(true) // repeated loss – stop remounting, surface the action
      }
    }

    canvas.addEventListener('webglcontextlost', onLost)
    return () => canvas.removeEventListener('webglcontextlost', onLost)
  }, [ready, generation, remount])

  return { generation, lost, recover }
}

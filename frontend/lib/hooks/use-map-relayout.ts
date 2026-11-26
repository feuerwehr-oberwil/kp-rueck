import { useEffect, type RefObject } from 'react'

/** The part of a MapLibre map a relayout pass listens to. */
export interface RelayoutMap {
  on(type: 'moveend', listener: () => void): unknown
  off(type: 'moveend', listener: () => void): unknown
  getCanvasContainer(): HTMLElement
}

/**
 * Runs `measure` – a placement pass over a map, e.g. which side an open incident card hangs on
 * (components/map/incident-label.tsx, `useCardSide`) – whenever its answer can change:
 *
 * - now, and every time the map comes to rest (`moveend`);
 * - when `target` changes size (the card's content loads);
 * - `settleMs` after the DOM under `root` changes outside the map's markers: the legend opens, a
 *   list folds out. The markers change with every frame and are not what a pass avoids.
 *
 * No map, no pass. `measure` must be stable (`useCallback`), or the listeners re-arm on every
 * render.
 */
export function useMapRelayout(
  map: RelayoutMap | null | undefined,
  measure: () => void,
  { root, target, settleMs }: { root?: RefObject<HTMLElement | null>; target?: RefObject<HTMLElement | null>; settleMs: number },
): void {
  useEffect(() => {
    if (!map) return
    measure()
    map.on('moveend', measure)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    if (target?.current) resize?.observe(target.current)
    const markers = map.getCanvasContainer()
    let settle: ReturnType<typeof setTimeout> | undefined
    const observer = new MutationObserver((records) => {
      if (records.every((record) => markers.contains(record.target))) return
      clearTimeout(settle)
      settle = setTimeout(measure, settleMs)
    })
    if (root?.current) observer.observe(root.current, { childList: true, subtree: true, attributes: true })
    return () => {
      map.off('moveend', measure)
      resize?.disconnect()
      observer.disconnect()
      clearTimeout(settle)
    }
  }, [map, measure, root, target, settleMs])
}

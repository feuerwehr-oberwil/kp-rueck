import { useCallback, useState } from "react"
import { useResizableWidth } from "@/lib/hooks/use-resizable-width"

/**
 * The desk rail's width: the operator's – ONE width for the Einsätze list, the Reko-Editor and
 * the Auftrags-Editor (owner picks 08. + 09.11.2026) – dragged by its left edge and remembered on
 * this device. 320 = the rail's own. The storage key is the one the Auftrags-Editor-only width
 * had, so a width dragged there stays.
 *
 * The row the rail sits in, measured: the rail never takes more than the row minus 12rem for the
 * map (at 768px with the notification sidebar open the row is 448px). The bounds go into the
 * hook, so the grip's value is the width that is drawn; the stored width stays and comes back
 * when there is room again. A drag writes the width into the DOM only, so neither the page nor
 * the map re-renders per pointer move. `railRef` goes on the rail's `<aside>`; `railWidth` feeds
 * its `ResizeGrip` and `style`.
 */
export function useRailWidth() {
  const [railRowWidth, setRailRowWidth] = useState<number | null>(null)
  const measureRailRow = useCallback((aside: HTMLElement | null) => {
    const row = aside?.parentElement
    if (!row) return
    const observer = new ResizeObserver(([entry]) => setRailRowWidth(entry.contentRect.width))
    observer.observe(row)
    return () => observer.disconnect()
  }, [])
  const railMax = railRowWidth === null ? 560 : Math.max(0, Math.min(560, Math.round(railRowWidth - 192)))
  const railWidth = useResizableWidth({
    storageKey: 'kp-map-planningWidth',
    defaultWidth: 320,
    min: Math.min(280, railMax),
    max: railMax,
    side: 'left',
  })
  const { panelRef: railPanelRef } = railWidth
  const railRef = useCallback(
    (aside: HTMLElement | null) => {
      railPanelRef(aside)
      return measureRailRow(aside)
    },
    [railPanelRef, measureRailRow],
  )
  return { railWidth, railRef }
}

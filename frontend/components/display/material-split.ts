"use client"

/**
 * Where the wall status page's Material groups stand (hill climb r19).
 *
 * At 1080p the four columns were badly out of balance: FAHRZEUGE ended halfway
 * down with the rest of its column empty, while MATERIAL ran off the bottom
 * (MAGAZIN never showed). So when Material does not fit its own column, its
 * FIRST groups continue under the vehicle tiles – TLF, PIO, … are the vehicles'
 * loadouts, so that is where they read naturally – as few as it takes for the
 * rest to fit, and never more than the room under the vehicles holds. Whole
 * groups only, in their order, with their own heads: nothing is cut, nothing is
 * shrunk, and a wall that fits as it is stays as it is.
 *
 * Usage (app/display/status/page.tsx): `const split = useMaterialSplit(refs, key)`,
 * then the first `split` groups render in the Fahrzeuge column under Material's
 * full head (count, summary) and the rest in the Material column under a quiet
 * «MATERIAL · FORTS.» (hill climb r21). Each group's box carries
 * `data-material-group`, the head in the Fahrzeuge column `data-material-head`.
 */

import { useEffect, useState, type RefObject } from "react"

/**
 * How many leading groups move: the smallest number after which the rest fits
 * the Material column; if none fits there, as many as the room allows. At least
 * one group always stays in its own column.
 *
 * `free` = the room under the vehicle tiles, `head` = the MATERIAL head's
 * height there, `own` = the Material column's height, all in px.
 */
export function materialSplit({ groupHeights, free, head, own }: {
  groupHeights: readonly number[]
  free: number
  head: number
  own: number
}): number {
  const total = groupHeights.reduce((sum, h) => sum + h, 0)
  if (total <= own + 1) return 0
  let moved = 0
  let best = 0
  for (let k = 1; k < groupHeights.length; k++) {
    moved += groupHeights[k - 1]
    if (moved + head > free + 1) break
    best = k
    if (total - moved <= own + 1) return k
  }
  return best
}

/** Below `sm` the panels stack and the page scrolls: no split there (lib/wall-stack). */
const SPLIT_MEDIA = "(min-width: 640px)"

/** The head's height before it has ever been drawn – the 60px column head + its top rule. */
const HEAD_FALLBACK_PX = 61

/**
 * Measures and re-measures the split live: on a resize of either column or the
 * vehicle list, and whenever a group's height changes (a row arrives, a group
 * folds, the search narrows it). `groupsKey` changes when the set of groups does.
 */
export function useMaterialSplit({ vehicleBody, vehicleList, materialBody, groupsKey }: {
  /** The Fahrzeuge column's scroller. */
  vehicleBody: RefObject<HTMLElement | null>
  /** The vehicle tiles' own box inside it. */
  vehicleList: RefObject<HTMLElement | null>
  /** The Material column's scroller. */
  materialBody: RefObject<HTMLElement | null>
  /** The group categories in reading order, joined. */
  groupsKey: string
}): number {
  const [split, setSplit] = useState(0)
  useEffect(() => {
    const body = vehicleBody.current
    const list = vehicleList.current
    const own = materialBody.current
    if (!body || !list || !own) return
    const media = window.matchMedia(SPLIT_MEDIA)
    const categories = groupsKey ? groupsKey.split("\u0000") : []
    let headPx = HEAD_FALLBACK_PX
    let frame = 0

    const groupBoxes = () => {
      const byCategory = new Map<string, HTMLElement>()
      for (const column of [body, own]) {
        for (const box of column.querySelectorAll<HTMLElement>(":scope > [data-material-group]")) {
          byCategory.set(box.dataset.materialGroup ?? "", box)
        }
      }
      return categories.map((c) => byCategory.get(c))
    }
    const measure = () => {
      frame = 0
      if (!media.matches) {
        setSplit(0)
        return
      }
      const head = body.querySelector<HTMLElement>("[data-material-head]")
      if (head) headPx = head.offsetHeight
      setSplit(materialSplit({
        groupHeights: groupBoxes().map((box) => box?.offsetHeight ?? 0),
        free: body.clientHeight - list.offsetHeight,
        head: headPx,
        own: own.clientHeight,
      }))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    const observeAll = () => {
      for (const el of [body, list, own, ...groupBoxes()]) if (el) resize.observe(el)
    }
    observeAll()
    // A group that moves column remounts: watch the new box as well.
    const mutations = new MutationObserver(() => {
      observeAll()
      schedule()
    })
    mutations.observe(body, { childList: true })
    mutations.observe(own, { childList: true })
    media.addEventListener("change", schedule)
    schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      media.removeEventListener("change", schedule)
    }
  }, [vehicleBody, vehicleList, materialBody, groupsKey])
  return split
}

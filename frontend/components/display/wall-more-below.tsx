"use client"

/**
 * The strip at a wall column's foot that says more is below (hill climb r19,
 * moved out of the list in r20).
 *
 * A wall column that does not fit at the 14px floor scrolls (settled) – but a
 * wall is never touched, so nothing said that the sixth card was there at all;
 * it was simply sliced at the screen's edge. While the column's scroller has
 * more below its visible end, a 28px strip stands UNDER the scroller, in flow:
 * the list (and a 32px fade to `--background` over its last lines) ends above
 * it, and centred in it, 14/18 600 ink on `--card`, «+n weiter ↓» – n the
 * cards or rows not fully in view (the sliced one included). In r19 the sign
 * was a chip laid over the list's foot and covered the last visible line
 * («Mannsch[+1 weiter ↓]p 1») – a label over text. No strip while nothing is
 * below. A sign, not a control: no pointer events, hidden from the
 * accessibility tree (every card is in the DOM and reachable as it was).
 *
 * Usage: a wall column's scroller is a `WallScrollBody` – the scroller's own
 * classes go on it as before (`flex-1 overflow-y-auto …`), and it wraps them in
 * the box that also holds the strip:
 *
 *   <div className="flex flex-col">
 *     <header …/>
 *     <WallScrollBody data-wall-column-body className="flex-1 overflow-y-auto p-2">{cards}</WallScrollBody>
 *   </div>
 *
 * `itemSelector` picks what counts (default: the scroller's direct children,
 * the wall board's cards); the status wall marks its rows `data-wall-item`.
 * Items that show the same thing twice carry the same `data-wall-key` and
 * count once – and not at all while one of them is in view (the status wall
 * lists an Auftrag's stop under the Auftrag AND under its status: «+n weiter»
 * counts Einsätze, not rows – hill climb r22).
 * `bodyRef` hands the scroller to a caller that measures it too. The strip
 * takes its 28px from the scroller, so a fit or split that measures the
 * scroller sees the room that is really left. Below `sm` the walls stack and
 * nothing scrolls inside a column, so the strip never shows.
 */

import { useEffect, useRef, useState, type ComponentProps, type RefObject } from "react"
import { useTranslations } from "next-intl"

/** One counted item: its box's bottom edge, and its `data-wall-key` when it has one. */
export interface WallItemBox {
  bottom: number
  key?: string
}

/** How many items end below `limit` (the scroller's visible end), an item with a
 *  key counting once per key and only when no item of that key is fully in view. */
export function countHiddenBelow(items: Iterable<WallItemBox>, limit: number): number {
  let count = 0
  const hiddenKeys = new Set<string>()
  const shownKeys = new Set<string>()
  for (const { bottom, key } of items) {
    const hidden = bottom > limit + 0.5
    if (key === undefined) count += hidden ? 1 : 0
    else (hidden ? hiddenKeys : shownKeys).add(key)
  }
  for (const key of hiddenKeys) if (!shownKeys.has(key)) count++
  return count
}

/** What is below the scroller's visible end: nothing (null), or how many items are not fully in view. */
export function useHiddenBelow(scrollRef: RefObject<HTMLElement | null>, itemSelector: string): number | null {
  const [hidden, setHidden] = useState<number | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame = 0
    const measure = () => {
      frame = 0
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 1) {
        setHidden(null)
        return
      }
      const items = [...el.querySelectorAll<HTMLElement>(itemSelector)].map((item) => ({
        bottom: item.getBoundingClientRect().bottom,
        key: item.dataset.wallKey,
      }))
      const count = countHiddenBelow(items, el.getBoundingClientRect().bottom)
      // Only padding below the last item is not «more».
      setHidden(count > 0 ? count : null)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    // The scroller's own box (window, top bar, the wall fit's root size), its
    // content (a card arrives, a section folds, a search narrows it) and the
    // scroll position itself.
    const resize = new ResizeObserver(schedule)
    resize.observe(el)
    for (const child of el.children) resize.observe(child)
    const mutations = new MutationObserver(() => {
      for (const child of el.children) resize.observe(child)
      schedule()
    })
    mutations.observe(el, { childList: true, subtree: true, characterData: true })
    el.addEventListener("scroll", schedule, { passive: true })
    schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      el.removeEventListener("scroll", schedule)
    }
  }, [scrollRef, itemSelector])
  return hidden
}

export function WallScrollBody({ itemSelector = ":scope > *", bodyRef, children, ...props }: Omit<ComponentProps<"div">, "ref"> & {
  itemSelector?: string
  bodyRef?: RefObject<HTMLDivElement | null>
}) {
  const t = useTranslations("display.common")
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = bodyRef ?? ownRef
  const hidden = useHiddenBelow(ref, itemSelector)
  return (
    // Takes the scroller's place in the column (and its stacked phone form: no
    // height of its own, lib/wall-stack); the scroller fills what the strip leaves.
    <div className="relative flex min-h-0 flex-1 flex-col max-sm:flex-none">
      <div ref={ref} {...props}>{children}</div>
      {hidden !== null && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[28px] h-8 bg-gradient-to-t from-background to-transparent max-sm:hidden" />
          <div
            aria-hidden
            data-wall-more-below
            className="pointer-events-none flex h-[28px] flex-none items-center justify-center border-t border-border bg-card text-[14px] font-semibold leading-[18px] tabular-nums text-foreground max-sm:hidden"
          >
            {t("moreBelow", { count: hidden })}
          </div>
        </>
      )}
    </div>
  )
}

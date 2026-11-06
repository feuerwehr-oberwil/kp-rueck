"use client"

/**
 * The sign at a wall column's foot that more is below (hill climb r19).
 *
 * A wall column that does not fit at the 14px floor scrolls (settled) – but a
 * wall is never touched, so nothing said that the sixth card was there at all;
 * it was simply sliced at the screen's edge. While the column's scroller has
 * more below its visible end this draws a 32px fade to `--background` over the
 * foot and, centred on it, the neutral ink chip «+n weiter ↓» – n the cards or
 * rows FULLY below the visible end (a sliced one is still partly in view). A
 * sign, not a control: no pointer events, hidden from the accessibility tree
 * (every card is in the DOM and reachable as it was).
 *
 * Usage: a wall column's scroller is a `WallScrollBody` – the scroller's own
 * classes go on it as before (`flex-1 overflow-y-auto …`), and it wraps them in
 * the positioned box the sign hangs in:
 *
 *   <div className="flex flex-col">
 *     <header …/>
 *     <WallScrollBody data-wall-column-body className="flex-1 overflow-y-auto p-2">{cards}</WallScrollBody>
 *   </div>
 *
 * `itemSelector` picks what counts (default: the scroller's direct children,
 * the wall board's cards); the status wall marks its rows `data-wall-item`.
 * `bodyRef` hands the scroller to a caller that measures it too. Below `sm` the
 * walls stack and nothing scrolls inside a column, so the sign never shows.
 */

import { useEffect, useRef, useState, type ComponentProps, type RefObject } from "react"
import { useTranslations } from "next-intl"
import { WALL_COLUMN_COUNT_CLASS } from "@/lib/kanban-utils"
import { cn } from "@/lib/utils"

/** What is below the scroller's visible end: nothing (null), or how many items are fully hidden. */
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
      const bottom = el.getBoundingClientRect().bottom
      let count = 0
      for (const item of el.querySelectorAll<HTMLElement>(itemSelector)) {
        if (item.getBoundingClientRect().top >= bottom - 0.5) count++
      }
      setHidden(count)
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

export function WallScrollBody({ itemSelector, bodyRef, children, ...props }: Omit<ComponentProps<"div">, "ref"> & {
  itemSelector?: string
  bodyRef?: RefObject<HTMLDivElement | null>
}) {
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = bodyRef ?? ownRef
  return (
    // The box the sign is positioned in; it takes the scroller's place in the
    // column (and its stacked phone form: no height of its own, lib/wall-stack).
    <div className="relative flex min-h-0 flex-1 flex-col max-sm:flex-none">
      <div ref={ref} {...props}>{children}</div>
      <WallMoreBelow scrollRef={ref} itemSelector={itemSelector} />
    </div>
  )
}

function WallMoreBelow({ scrollRef, itemSelector = ":scope > *" }: {
  scrollRef: RefObject<HTMLElement | null>
  itemSelector?: string
}) {
  const t = useTranslations("display.common")
  const hidden = useHiddenBelow(scrollRef, itemSelector)
  if (hidden === null) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 max-sm:hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      {hidden > 0 && (
        // The column count chip's geometry and ink (WALL_COLUMN_COUNT_CLASS), on
        // an opaque base: its /10 tint alone would let the card under it show through.
        <div className="absolute inset-x-0 bottom-1 flex justify-center">
          <span className="rounded-sm bg-background shadow-sm">
            <span className={cn(WALL_COLUMN_COUNT_CLASS, "gap-1")}>{t("moreBelow", { count: hidden })}</span>
          </span>
        </div>
      )}
    </div>
  )
}

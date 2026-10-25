"use client"

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { cn } from '@/lib/utils'
import { COLUMN_HEADER_CLASS, STATUS_ACCENT } from '@/lib/kanban-utils'
import {
  EDGE_TAB_PAD_GIVE,
  EDGE_TAB_WIDTH,
  computeEdgeOverflow,
  scrollTargetFor,
  type BoardScrollGeometry,
  type EdgeOverflow,
} from '@/lib/board-edge-overflow'
import type { Operation, OperationStatus } from '@/lib/contexts/operations-context'

interface EdgeLayout extends EdgeOverflow {
  padLeft: number
  padRight: number
  padTop: number
  /** Height of the horizontal scrollbar under the columns – the stack ends above it. */
  scrollbar: number
}

const NONE: EdgeLayout = { left: [], right: [], padLeft: 0, padRight: 0, padTop: 0, scrollbar: 0 }

function measure(scroller: HTMLElement): BoardScrollGeometry & { padTop: number; scrollbar: number } {
  const style = getComputedStyle(scroller)
  const box = scroller.getBoundingClientRect()
  const origin = box.left + scroller.clientLeft - scroller.scrollLeft
  const columns = Array.from(scroller.querySelectorAll<HTMLElement>('[data-column]'), (el) => {
    const r = el.getBoundingClientRect()
    return { id: el.dataset.column ?? '', left: r.left - origin, right: r.right - origin }
  })
  return {
    scrollLeft: scroller.scrollLeft,
    clientWidth: scroller.clientWidth,
    scrollWidth: scroller.scrollWidth,
    padLeft: parseFloat(style.paddingLeft) || 0,
    padRight: parseFloat(style.paddingRight) || 0,
    padTop: parseFloat(style.paddingTop) || 0,
    scrollbar: scroller.offsetHeight - scroller.clientHeight - scroller.clientTop * 2,
    columns,
  }
}

/**
 * Watches the board scroller (`#kanban-main`) and says which columns are hidden past each
 * edge. Re-measures on scroll, on resize (sidebars, window) and when columns are swapped
 * in or out (a fold replaces the column with its strip). `scrollToColumn` brings one back.
 */
export function useBoardEdgeOverflow(scrollerRef: RefObject<HTMLElement | null>) {
  const [layout, setLayout] = useState<EdgeLayout>(NONE)

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let frame = 0
    const update = () => {
      frame = 0
      const g = measure(scroller)
      const next: EdgeLayout = {
        ...computeEdgeOverflow(g),
        padLeft: g.padLeft,
        padRight: g.padRight,
        padTop: g.padTop,
        scrollbar: g.scrollbar,
      }
      setLayout((prev) =>
        prev.left.join() === next.left.join() && prev.right.join() === next.right.join() &&
        prev.padLeft === next.padLeft && prev.padRight === next.padRight &&
        prev.padTop === next.padTop && prev.scrollbar === next.scrollbar
          ? prev
          : next,
      )
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }

    schedule()
    scroller.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(scroller)
    // childList only: cards and columns coming and going, not every ticking clock.
    const mutations = new MutationObserver(schedule)
    mutations.observe(scroller, { childList: true, subtree: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      resize.disconnect()
      mutations.disconnect()
    }
  }, [scrollerRef])

  const scrollToColumn = useCallback((id: string) => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const left = scrollTargetFor(measure(scroller), id)
    if (left === null) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
    // The tab is about to vanish under the keyboard user's focus: hand focus to the column
    // it named (its fold handle, or the folded strip itself), without a second scroll.
    const column = scroller.querySelector<HTMLElement>(`[data-column="${id}"]`)
    const target = column?.matches('button') ? column : column?.querySelector<HTMLElement>('button')
    target?.focus({ preventScroll: true })
  }, [scrollerRef])

  return { ...layout, scrollToColumn }
}

/** Finished work does not fly a Hoch signal – same reasoning as `isOverdue`. */
const FINISHED: readonly OperationStatus[] = ['returning', 'complete']

interface EdgeTabProps {
  column: { id: OperationStatus; status: OperationStatus[] }
  side: 'left' | 'right'
  operations: readonly Operation[]
  onShow: (id: string) => void
}

/** One folded tab: accent rule, chevron, count (red dot when Hoch), vertical title. A real
 *  button, and a drop target for its column – a card dragged onto it lands there. */
function EdgeTab({ column, side, operations, onShow }: EdgeTabProps) {
  const t = useTranslations('kanban')
  const ref = useRef<HTMLButtonElement | null>(null)
  const [isOver, setIsOver] = useState(false)
  const title = t(`columns.${column.id}`)
  const count = operations.length
  const high = FINISHED.includes(column.id) ? 0 : operations.filter((op) => op.priority === 'high').length

  useEffect(() => {
    const element = ref.current
    if (!element) return
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => source.data.type === 'operation',
      getData: () => ({ type: 'column', columnId: column.id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [column.id])

  const Chevron = side === 'right' ? ChevronRight : ChevronLeft
  return (
    <button
      ref={ref}
      type="button"
      data-edge-tab={column.id}
      onClick={() => onShow(column.id)}
      aria-label={t('edgeTabs.label', { title, count, high })}
      title={t('edgeTabs.label', { title, count, high })}
      className={cn(
        'flex min-h-0 flex-1 cursor-pointer flex-col items-center gap-2 overflow-hidden rounded-lg border border-border bg-card pb-3 shadow-sm transition-colors hover:bg-secondary',
        isOver && 'drop-zone-active',
      )}
    >
      <span aria-hidden className={cn('h-0.5 w-full shrink-0', STATUS_ACCENT[column.id]?.dot)} />
      <Chevron aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span aria-hidden className="relative inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-foreground/10 px-1.5 text-foreground type-label tabular-nums">
        {count}
        {high > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />}
      </span>
      <span aria-hidden className={cn(COLUMN_HEADER_CLASS, 'min-h-0 [writing-mode:vertical-rl]')}>{title}</span>
      {high > 0 && (
        <span aria-hidden className="text-xs font-semibold text-destructive [writing-mode:vertical-rl]">
          {t('edgeTabs.high', { count: high })}
        </span>
      )}
    </button>
  )
}

interface BoardEdgeTabsProps {
  scrollerRef: RefObject<HTMLElement | null>
  columns: ReadonlyArray<{ id: OperationStatus; status: OperationStatus[] }>
  /** The operations the board draws (after search/filter) – the tab counts match the columns. */
  operations: readonly Operation[]
}

/**
 * The folded tabs at the board's edges for columns entirely out of view (UX-DESKTOP-07 «D»):
 * pinned over the board inside its padding, absent when every column shows at least a sliver.
 * A partly visible column is drawn as always; the stack may lie over its edge. Must sit in
 * the same positioned container as the scroller, which fills it.
 */
export function BoardEdgeTabs({ scrollerRef, columns, operations }: BoardEdgeTabsProps) {
  const t = useTranslations('kanban')
  const { left, right, padLeft, padRight, padTop, scrollbar, scrollToColumn } = useBoardEdgeOverflow(scrollerRef)

  const stack = (side: 'left' | 'right', ids: string[]) => {
    if (ids.length === 0) return null
    const inset = Math.max(0, (side === 'left' ? padLeft : padRight) - EDGE_TAB_PAD_GIVE)
    return (
      <nav
        aria-label={t(side === 'left' ? 'edgeTabs.navLeft' : 'edgeTabs.navRight')}
        className="absolute z-pinned flex flex-col gap-2"
        style={{ ...(side === 'left' ? { left: inset } : { right: inset }), top: padTop, bottom: scrollbar + 8, width: EDGE_TAB_WIDTH }}
      >
        {columns.filter((c) => ids.includes(c.id)).map((column) => (
          <EdgeTab
            key={column.id}
            column={column}
            side={side}
            operations={operations.filter((op) => column.status.includes(op.status))}
            onShow={scrollToColumn}
          />
        ))}
      </nav>
    )
  }

  return (
    <>
      {stack('left', left)}
      {stack('right', right)}
    </>
  )
}

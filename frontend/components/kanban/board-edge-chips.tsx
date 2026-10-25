"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { cn } from '@/lib/utils'
import { COLUMN_HEADER_CLASS, STATUS_ACCENT } from '@/lib/kanban-utils'
import {
  computeEdgeOverflow,
  scrollTargetFor,
  type BoardScrollGeometry,
  type EdgeOverflow,
} from '@/lib/board-edge-overflow'
import type { Operation, OperationStatus } from '@/lib/contexts/operations-context'

const NONE: EdgeOverflow = { left: [], right: [] }

function measure(scroller: HTMLElement): BoardScrollGeometry {
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
    columns,
  }
}

/**
 * Watches the board scroller (`#kanban-main`, passed as the element once it is mounted) and
 * says which columns are hidden past each edge. Re-measures on scroll, on resize (sidebars,
 * window) and when columns are swapped in or out (a fold replaces the column with its strip).
 * `scrollToColumn` brings one back.
 */
export function useBoardEdgeOverflow(scroller: HTMLElement | null) {
  const [overflow, setOverflow] = useState<EdgeOverflow>(NONE)

  useEffect(() => {
    if (!scroller) return
    let frame = 0
    const update = () => {
      frame = 0
      const next = computeEdgeOverflow(measure(scroller))
      setOverflow((prev) =>
        prev.left.join() === next.left.join() && prev.right.join() === next.right.join() ? prev : next,
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
  }, [scroller])

  const scrollToColumn = useCallback((id: string) => {
    if (!scroller) return
    const left = scrollTargetFor(measure(scroller), id)
    if (left === null) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' })
    // The chip is about to vanish under the keyboard user's focus: hand focus to the column
    // it named (its fold handle, or the folded strip itself), without a second scroll.
    const column = scroller.querySelector<HTMLElement>(`[data-column="${id}"]`)
    const target = column?.matches('button') ? column : column?.querySelector<HTMLElement>('button')
    target?.focus({ preventScroll: true })
  }, [scroller])

  return { ...(scroller ? overflow : NONE), scrollToColumn }
}

/** Finished work does not fly a Hoch signal – same reasoning as `isOverdue`. */
const FINISHED: readonly OperationStatus[] = ['returning', 'complete']

interface EdgeChipProps {
  column: { id: OperationStatus; status: OperationStatus[] }
  side: 'left' | 'right'
  operations: readonly Operation[]
  onShow: (id: string) => void
  /** Title and «n Hoch» left out (both stay in the tooltip and the accessible name). */
  compact: boolean
}

/** One hidden column: chevron toward its edge, status tick, title, count (red dot when Hoch).
 *  A real button, and a drop target for its column – a card dragged onto it lands there.
 *  `compact` when the bar runs short: tick, count and chevron only. */
function EdgeChip({ column, side, operations, onShow, compact }: EdgeChipProps) {
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

  const chevron = <span aria-hidden className="shrink-0 text-muted-foreground">
    {side === 'right' ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
  </span>
  return (
    <button
      ref={ref}
      type="button"
      data-edge-tab={column.id}
      onClick={() => onShow(column.id)}
      aria-label={t('edgeTabs.label', { title, count, high })}
      title={t('edgeTabs.label', { title, count, high })}
      className={cn(
        'flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-sm border border-border bg-card transition-colors hover:bg-secondary',
        compact ? 'px-1.5' : 'px-2.5',
        isOver && 'drop-zone-active',
      )}
    >
      {side === 'left' && chevron}
      <span aria-hidden className={cn('h-3.5 w-0.5 shrink-0 rounded-full', STATUS_ACCENT[column.id]?.dot)} />
      {!compact && <span aria-hidden className={cn(COLUMN_HEADER_CLASS, 'whitespace-nowrap')}>{title}</span>}
      <span aria-hidden className="relative inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-foreground/10 px-1.5 text-foreground type-label tabular-nums">
        {count}
        {high > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />}
      </span>
      {high > 0 && !compact && (
        <span aria-hidden className="whitespace-nowrap text-xs font-semibold text-destructive">
          {t('edgeTabs.high', { count: high })}
        </span>
      )}
      {side === 'right' && chevron}
    </button>
  )
}

interface BoardEdgeChipBarProps {
  /** The hidden column ids per side, from `useBoardEdgeOverflow`. */
  left: readonly string[]
  right: readonly string[]
  columns: ReadonlyArray<{ id: OperationStatus; status: OperationStatus[] }>
  /** The operations the board draws (after search/filter) – the chip counts match the columns. */
  operations: readonly Operation[]
  onShow: (id: string) => void
}

/**
 * The columns entirely out of view, as chips in the board's top bar (UX-DESKTOP-07, owner
 * pick «C», 2026-10-25): left-hidden ones at the bar's start, right-hidden ones at its end,
 * nothing laid over the board – a partly visible column, its cards and the sidebar handles
 * stay clear. Fills the free room between the Ereignis title and the search; when the full
 * chips do not fit there they turn compact («6 ›»), and when not even those fit (a narrow
 * window with both sidebars) the bar stays empty rather than showing a clipped chip – the
 * cut column and the scrollbar still say there is more. Empty when every column shows.
 */
export function BoardEdgeChipBar({ left, right, columns, operations, onShow }: BoardEdgeChipBarProps) {
  const t = useTranslations('kanban')
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [fit, setFit] = useState<'full' | 'compact' | 'none'>('full')

  // Fit again from full whenever the chips or the room change (state reset during render,
  // so the check below always sees the full chips first).
  const fitKey = `${left.join()}|${right.join()}|${width}`
  const [fittedFor, setFittedFor] = useState(fitKey)
  if (fittedFor !== fitKey) {
    setFittedFor(fitKey)
    setFit('full')
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const resize = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    resize.observe(el)
    return () => resize.disconnect()
  }, [])

  // Before paint: chips that overflow the room step down – full → compact → none.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && fit !== 'none' && el.scrollWidth > el.clientWidth) setFit(fit === 'full' ? 'compact' : 'none')
  }, [fit, fitKey])

  const nav = (side: 'left' | 'right', ids: readonly string[]) => ids.length > 0 && fit !== 'none' && (
    <nav
      aria-label={t(side === 'left' ? 'edgeTabs.navLeft' : 'edgeTabs.navRight')}
      className={cn('flex shrink-0 items-center gap-1.5', side === 'right' && 'ml-auto')}
    >
      {columns.filter((c) => ids.includes(c.id)).map((column) => (
        <EdgeChip
          key={column.id}
          column={column}
          side={side}
          operations={operations.filter((op) => column.status.includes(op.status))}
          onShow={onShow}
          compact={fit === 'compact'}
        />
      ))}
    </nav>
  )

  // `overflow-hidden` keeps the overflowing step from showing for the one measuring render;
  // the padding keeps the Hoch dot (it pokes out above) and the focus ring unclipped.
  return (
    <div ref={ref} className="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-1 py-1">
      {nav('left', left)}
      {nav('right', right)}
    </div>
  )
}

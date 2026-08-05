"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { FileText, Map as MapIcon, PanelRight, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { useEvent } from "@/lib/contexts/event-context"
import type { Operation } from "@/lib/contexts/operations-context"
import {
  OperationDetailContent,
  type OperationDetailContentProps,
} from "@/components/kanban/operation-detail-content"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"
import { readItem, writeItem } from "@/lib/utils/safe-storage"
import { cn } from "@/lib/utils"

interface SidePanelProps extends Omit<OperationDetailContentProps, 'operation' | 'layout' | 'active'> {
  mode: 'detail' | 'map' | 'collapsed'
  onModeChange: (mode: 'detail' | 'map' | 'collapsed') => void
  selectedOperation: Operation | null
  operations: Operation[]
  onSelectOperation: (operation: Operation) => void
  panToNonce?: number
}

export function SidePanel({
  mode,
  onModeChange,
  selectedOperation,
  operations,
  onSelectOperation,
  panToNonce,
  ...detailProps
}: SidePanelProps) {
  const t = useTranslations('kanban')
  const { selectedEvent } = useEvent()
  const [isWideEnough, setIsWideEnough] = useState<boolean | null>(null)

  useEffect(() => {
    const checkWidth = () => setIsWideEnough(window.innerWidth >= SIDE_PANEL_BREAKPOINT)
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  useEffect(() => {
    if (isWideEnough === false && mode !== 'collapsed') onModeChange('collapsed')
  }, [isWideEnough, mode, onModeChange])

  if (isWideEnough !== true) return null

  if (mode === 'collapsed') {
    return <CollapsedToggle onOpen={() => onModeChange('detail')} label={t('sidePanel.togglePanel')} />
  }

  return (
    <aside className="flex w-[420px] flex-col border-l border-border bg-card/30 backdrop-blur-sm 2xl:w-[480px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant={mode === 'detail' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onModeChange('detail')}
            className="px-3"
          >
            <FileText className="h-4 w-4" />
            {t('sidePanel.details')}
          </Button>
          <Button
            variant={mode === 'map' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onModeChange('map')}
            className="px-3"
          >
            <MapIcon className="h-4 w-4" />
            {t('sidePanel.map')}
          </Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => onModeChange('collapsed')} aria-label={t('sidePanel.togglePanel')}>
              <PanelRightClose className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.close')}</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-hidden">
        {mode === 'detail' && (
          selectedOperation ? (
            <div className="h-full p-4">
              <OperationDetailContent
                key={`${selectedEvent?.id ?? 'no-event'}:${selectedOperation.id}`}
                {...detailProps}
                operation={selectedOperation}
                layout="panel"
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-muted-foreground">
              <p className="text-center text-sm">{t('sidePanel.clickToView')}</p>
            </div>
          )
        )}
        {mode === 'map' && (
          <SidePanelMap
            operations={operations}
            selectedOperation={selectedOperation}
            panToNonce={panToNonce}
            onSelectOperation={onSelectOperation}
            onSwitchToDetail={(operation) => {
              onSelectOperation(operation)
              onModeChange('detail')
            }}
          />
        )}
      </div>
    </aside>
  )
}

const SidePanelMapContent = dynamic(
  () => import("./side-panel-map"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">{translateOutsideReact('kanban.sidePanel.mapLoading')}</p>
      </div>
    ),
  },
)

function SidePanelMap({
  operations,
  selectedOperation,
  panToNonce,
  onSelectOperation,
  onSwitchToDetail,
}: {
  operations: Operation[]
  selectedOperation: Operation | null
  panToNonce?: number
  onSelectOperation: (operation: Operation) => void
  onSwitchToDetail: (operation: Operation) => void
}) {
  return (
    <div className="h-full">
      <SidePanelMapContent
        operations={operations}
        selectedOperation={selectedOperation}
        panToNonce={panToNonce}
        onSelectOperation={onSelectOperation}
        onSwitchToDetail={onSwitchToDetail}
      />
    </div>
  )
}

/** Default distance from the top, matching the old fixed `top-24`. */
const TOGGLE_DEFAULT_TOP = 96
const TOGGLE_STORAGE_KEY = 'kp-board-sidePanelToggleTop'
/** Movement past this many pixels is a drag, not a click. Below it, a shaky
 *  hand on a mouse button still opens the panel. */
const DRAG_THRESHOLD = 4

/**
 * The floating "open the side panel" button.
 *
 * It is `position: fixed`, so it sits ON TOP of whatever the board has at that
 * spot — column headers and their count badges, most often — and swallows those
 * clicks. Rather than pick a corner that happens to be empty on one screen and
 * occupied on the next, the button can be dragged up and down the right edge
 * and remembers where it was put.
 *
 * The drag is deliberately vertical-only: the button belongs to the right-hand
 * panel it opens, and letting it wander into the middle of the board would make
 * it harder to find again, not easier.
 */
function CollapsedToggle({ onOpen, label }: { onOpen: () => void; label: string }) {
  const [top, setTop] = useState(TOGGLE_DEFAULT_TOP)
  const [dragging, setDragging] = useState(false)
  const dragState = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const saved = Number(readItem(TOGGLE_STORAGE_KEY))
    if (Number.isFinite(saved) && saved > 0) setTop(clampTop(saved))
  }, [])

  // A window that got shorter must not strand the button off-screen.
  useEffect(() => {
    const onResize = () => setTop((current) => clampTop(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    dragState.current = { startY: event.clientY, startTop: top, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current
    if (!state) return
    const delta = event.clientY - state.startY
    if (!state.moved && Math.abs(delta) < DRAG_THRESHOLD) return
    state.moved = true
    setDragging(true)
    setTop(clampTop(state.startTop + delta))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = dragState.current
    dragState.current = null
    setDragging(false)
    if (!state) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (state.moved) {
      suppressClickRef.current = true
      writeItem(TOGGLE_STORAGE_KEY, String(top))
      return
    }
    // A real click follows this pointerup and `onClick` handles the open, so
    // doing it here as well would toggle twice.
  }

  const button = (
    <Button
      variant="secondary"
      size="icon"
      style={{ top }}
      // Keyboard activation of a <button> dispatches `click`, never pointer
      // events — without this, Enter/Space stopped opening the panel when the
      // drag handling went in. `pointerup` already handled the mouse path, so
      // this fires only when no drag was in progress.
      onClick={() => {
        // A drag ends with a `click` too, and by then `dragState` is already
        // cleared — so the "did I just drag this?" answer has to outlive it,
        // or repositioning the button would also open the panel.
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          return
        }
        onOpen()
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragState.current = null
        setDragging(false)
      }}
      className={cn(
        'fixed right-4 z-40 h-10 w-10 touch-none rounded-full border border-border shadow-lg',
        // Faded until pointed at, so whatever it covers stays readable.
        dragging ? 'cursor-grabbing opacity-100' : 'cursor-grab opacity-70 hover:opacity-100',
      )}
      aria-label={label}
    >
      <PanelRight className="h-5 w-5" />
    </Button>
  )

  // No tooltip mid-drag — it would follow the pointer around the screen.
  if (dragging) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Keep the button fully on screen, clear of the header. */
function clampTop(value: number): number {
  const max = (typeof window === 'undefined' ? 800 : window.innerHeight) - 56
  return Math.min(Math.max(value, 64), Math.max(64, max))
}

"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Map as MapIcon, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEvent } from "@/lib/contexts/event-context"
import type { Operation } from "@/lib/contexts/operations-context"
import {
  OperationDetailContent,
  type OperationDetailContentProps,
} from "@/components/kanban/operation-detail-content"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"

interface SidePanelProps extends Omit<OperationDetailContentProps, 'operation' | 'layout' | 'active' | 'headerActions'> {
  mode: 'detail' | 'collapsed'
  onModeChange: (mode: 'detail' | 'collapsed') => void
  selectedOperation: Operation | null
  /** Show this incident on the Karte page. Navigation belongs to the page that
   *  owns the route, not to a panel — and a panel that reached for `useRouter`
   *  could not be rendered outside one. */
  onOpenOnMap?: () => void
}

export function SidePanel({
  mode,
  onModeChange,
  selectedOperation,
  onOpenOnMap,
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

  // Collapsed, this component renders NOTHING. The tab that reopens it is drawn
  // by the board instead, pinned inside the board's own box (see app/page.tsx) —
  // because anything rendered here is a flex item of the outer row, and a flex
  // item reserves its width down the ENTIRE height of the board even when the
  // control itself is 48px tall. That empty 20px column beside the
  // Material-Leiste was exactly what it looked like: a column.
  if (mode === 'collapsed') return null

  const modeControls = (
    <>
      {/* Not an inset map any more: the Karte page is bigger, has the tools,
          and can show this incident among all the others. It carries the
          selection over as ?highlight= — the same parameter the board reads
          coming back, so the two surfaces hand the incident to each other. */}
      {onOpenOnMap && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onOpenOnMap}
              aria-label={t('sidePanel.openOnMap')}
            >
              <MapIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sidePanel.openOnMap')}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onModeChange('collapsed')}
            aria-label={t('sidePanel.togglePanel')}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('common.close')}</TooltipContent>
      </Tooltip>
    </>
  )

  return (
    <aside className="flex w-[420px] flex-col border-l border-border bg-card/30 backdrop-blur-sm 2xl:w-[480px]">
      {/* No bar of its own. Details/Karte and the close button ride in the
          detail's title row — three stacked control rows (bar, title, tabs) in a
          420px column spent ~200px before a single field appeared. The map,
          which is not the detail, keeps a minimal one. */}
      <div className="flex-1 overflow-hidden">
        {selectedOperation ? (
          <div className="h-full p-4">
            <OperationDetailContent
              key={`${selectedEvent?.id ?? 'no-event'}:${selectedOperation.id}`}
              {...detailProps}
              operation={selectedOperation}
              layout="panel"
              headerActions={modeControls}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col p-4">
            <div className="flex items-center justify-end gap-1">{modeControls}</div>
            <p className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
              {t('sidePanel.clickToView')}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}

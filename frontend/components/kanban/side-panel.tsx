"use client"

import { useEffect, useState } from "react"
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

interface SidePanelProps extends Omit<OperationDetailContentProps, 'operation' | 'layout' | 'active'> {
  mode: 'detail' | 'map' | 'collapsed'
  onModeChange: (mode: 'detail' | 'map' | 'collapsed') => void
  selectedOperation: Operation | null
  operations: Operation[]
  formatLocation: (address: string) => string
  onSelectOperation: (operation: Operation) => void
  panToNonce?: number
}

export function SidePanel({
  mode,
  onModeChange,
  selectedOperation,
  operations,
  formatLocation,
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
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => onModeChange('detail')}
            className="fixed right-4 top-24 z-40 h-10 w-10 rounded-full border border-border shadow-lg"
            aria-label={t('sidePanel.togglePanel')}
          >
            <PanelRight className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('sidePanel.togglePanel')}</TooltipContent>
      </Tooltip>
    )
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
            formatLocation={formatLocation}
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
  formatLocation,
}: {
  operations: Operation[]
  selectedOperation: Operation | null
  panToNonce?: number
  onSelectOperation: (operation: Operation) => void
  onSwitchToDetail: (operation: Operation) => void
  formatLocation: (address: string) => string
}) {
  return (
    <div className="h-full">
      <SidePanelMapContent
        operations={operations}
        selectedOperation={selectedOperation}
        panToNonce={panToNonce}
        onSelectOperation={onSelectOperation}
        onSwitchToDetail={onSwitchToDetail}
        formatLocation={formatLocation}
      />
    </div>
  )
}

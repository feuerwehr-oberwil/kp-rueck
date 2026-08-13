"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Map as MapIcon, PanelRight, PanelRightClose } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEvent } from "@/lib/contexts/event-context"
import type { Operation } from "@/lib/contexts/operations-context"
import {
  OperationDetailContent,
  type OperationDetailContentProps,
} from "@/components/kanban/operation-detail-content"
import { SIDE_PANEL_BREAKPOINT } from "@/lib/layout-breakpoints"
import { cn } from "@/lib/utils"

interface SidePanelProps extends Omit<OperationDetailContentProps, 'operation' | 'layout' | 'active' | 'headerActions'> {
  mode: 'detail' | 'collapsed'
  onModeChange: (mode: 'detail' | 'collapsed') => void
  selectedOperation: Operation | null
  /** Show this incident on the Karte page. Navigation belongs to the page that
   *  owns the route, not to a panel — and a panel that reached for `useRouter`
   *  could not be rendered outside one. */
  onOpenOnMap?: () => void
  /** Position the collapsed tab out of flow, mirroring the Personen-Leiste's
   *  reopen control, so the board keeps the full width. Set by the board when
   *  nothing else occupies the right edge; with the Material-Leiste open the tab
   *  stays in flow beside it instead of sitting on its list. */
  floatCollapsed?: boolean
}

export function SidePanel({
  mode,
  onModeChange,
  selectedOperation,
  onOpenOnMap,
  floatCollapsed = false,
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
      <CollapsedRail
        onOpen={() => onModeChange('detail')}
        label={t('sidePanel.railLabel')}
        floating={floatCollapsed}
      />
    )
  }

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

/**
 * The closed side panel: the same tab the sidebars already use to reopen
 * themselves. Deliberately NOT a new invention — see `app/page.tsx`, where the
 * Personen-Leiste's reopen control is `absolute left-1 top-1/2 -translate-y-1/2`
 * on a 12×5 pill. That pattern is the one that works: because it is positioned
 * out of flow it costs the board no width at all, which is why the left edge
 * never leaves an empty strip behind.
 *
 * Two earlier attempts here did leave one. A `position: fixed` circle covered
 * whatever sat under it and swallowed those clicks; a full-height 44px rail with
 * a vertical «EINSATZ-DETAIL» label fixed the covering but reserved a column
 * that was lighter than the board and empty below its label — a white strip.
 *
 * `floating` is what keeps it honest on a side that, unlike the left, can have
 * something else at its edge: with the Material-Leiste open the pill goes back
 * into the flow beside it rather than parking on top of its list.
 */
function CollapsedRail({
  onOpen,
  label,
  floating,
}: {
  onOpen: () => void
  label: string
  floating?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      aria-label={label}
      className={cn(
        'z-20 flex h-12 w-5 cursor-pointer items-center justify-center',
        'rounded-md border border-border bg-card text-muted-foreground shadow-sm',
        'transition-colors hover:bg-secondary/60 hover:text-foreground',
        // Top-right, NOT beside the Material-Leiste's own chevron. Both pinned
        // to the same vertical centre put one control "to the left of" the
        // other, which reads as a row of two chevrons doing the same job. Given
        // its own corner, the vertical position is the hint: this one opens the
        // panel that fills the right side, the centred one opens the sidebar.
        // `right-1` still clears the columns — the board's `px-4` means the pill
        // only ever overlaps that padding, never a column header's controls.
        // Top in BOTH cases. Floating it pins to the container; in the flow the
        // row stretches its children, so `mb-auto` is what holds it up top
        // instead of centring it — otherwise opening the Material-Leiste made
        // the opener jump from the corner to the middle of the screen, which is
        // the sort of thing an operator has to re-find under pressure.
        floating ? 'absolute right-1 top-3' : 'mx-1 mt-3 mb-auto flex-none',
      )}
    >
      <PanelRight className="h-4 w-4 shrink-0" />
    </button>
  )
}

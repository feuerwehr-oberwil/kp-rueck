"use client"

import { type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { IncidentNumber } from "@/components/ui/incident-number"
import { PriorityGlyph } from "@/components/ui/priority-glyph"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Kbd } from "@/components/ui/kbd"
import { IncidentTime, useIncidentTimeVisible } from "@/components/ui/incident-time"
import { AddressText } from "@/components/kanban/address-text"
import { type Operation, useOperations } from "@/lib/contexts/operations-context"
import { OPERATION_DETAIL_TABS, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { cn } from "@/lib/utils"
import { detailTabLayout, type DetailLayout } from "@/components/kanban/operation-detail-tab-layout"

/** The ← / → key caps beside the tab bar: hints, not buttons (the Kbd is
 *  `pointer-events-none`). A 24px cap, a 14px arrow; desktop only. */
const TAB_ARROW_KEY = "hidden size-6 shrink-0 px-0 lg:inline-flex"
const TAB_ARROW_ICON = "size-3.5"

/**
 * The incident detail's title row: priority, number, address and time, the
 * mount's own controls (`headerActions`), and the tab bar with its ← / → hints.
 * Rendered by `OperationDetailContent` inside its Radix `Tabs`, which the
 * triggers here belong to.
 */
export function OperationDetailHeader({
  operation,
  layout,
  tab,
  headerActions,
}: {
  operation: Operation
  layout: DetailLayout
  tab: OperationDetailTab
  headerActions?: ReactNode
}) {
  const t = useTranslations('kanban')
  const { formatLocation } = useOperations()
  const { dense } = detailTabLayout(layout)
  // The «·» separator has to vanish with the chip, or a closed incident keeps an
  // orphan dot behind the id.
  const showIncidentTime = useIncidentTimeVisible(operation.status === "complete")
  // The panel's tab bar shares its row with the ← / → hints, so its triggers
  // take their own label plus a share of whatever is left (`flex-auto`) rather
  // than a fixed quarter each (`flex-1`, the default): «Rapport · erfasst» is
  // wider than a quarter of 420px and would spill over «Chronik».
  // Natural widths in the modal: the shared trigger is `flex-1` (basis 0), which splits the
  // list into equal quarters — narrower than «Übersicht» itself, which then ran out of its
  // tab (overflow sweep, 03.10.).
  const tabTriggerClass = dense ? "flex-auto px-1.5" : "flex-none"

  return (
    <header
      className={cn(
        "flex flex-shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2",
        layout === 'modal' && "pr-8",
      )}
    >
      {/* In the panel this row carries everything: address, time, and the
          mode/close controls the panel used to spend a bar of its own on. */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <h2
          className={cn(
            "flex items-center gap-2.5 font-semibold leading-none tracking-tight",
            // The panel row also carries the clock and three controls: the
            // address gives way rather than wrapping, and it is the only
            // part that may.
            dense ? "min-w-0 text-lg" : "text-xl",
          )}
          // The address is what truncates in the panel, so hovering the
          // title spells it out. (The id used to ride along here; it is
          // gone from both mounts — see the note below the title.)
          title={dense
            ? formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)
            : undefined}
        >
          {/* The card's priority mark before the number (it was a muted map pin, so
              the header said nothing about priority): the wall's drawing, 14px at 2px,
              beside an 18–20px address (hill climb r20). */}
          <PriorityGlyph priority={operation.priority} size="wall" />
          <IncidentNumber number={operation.number} className="shrink-0 text-sm" />
          {/* min-w-0 as well as truncate: a flex item refuses to shrink
              below its content without it, so the address pushed the clock
              and the panel controls off the row instead of giving way. */}
          <span className={cn(dense && "min-w-0 truncate")}>
            <AddressText text={formatLocation(operation.location ?? '') || getIncidentTypeLabel(operation.incidentType)} />
          </span>
          {dense && showIncidentTime && (
            // The wrapper, not the component's own className: the chip is a
            // button with its own classes and was being squeezed to «171h 3»
            // instead of letting the address give way.
            <span className="shrink-0">
              <IncidentTime
                operation={operation}
                suppressDurations={operation.status === "complete"}
                className="font-normal"
              />
            </span>
          )}
        </h2>
        {/* The line under the title: what identifies the incident without
            being its address — the id and the time chip. «Abholung» used to
            ride here as a chip and is now one of the banners below the tabs
            / in the Übersicht column, where it states the same fact as a
            sentence with its «erledigt» control attached.
            In the panel the clock rides the title row, so there is nothing
            left to show.
            The incident id is gone from both mounts. Thirty-six monospace
            characters were the most prominent thing under the address, and
            nobody at a command post reads a UUID — not aloud, not off the
            screen, not into a report. */}
        {!dense && showIncidentTime && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {/* The board-wide time chip (start / in status / since alarm). Its
              durations are dropped once the incident is closed: a running clock
              on a finished Einsatz reads «19h 40'» the next morning and answers
              nothing. The Verlauf tab holds the actual times. */}
          <IncidentTime operation={operation} size="lg" suppressDurations={operation.status === "complete"} />
        </div>
        )}
      </div>
      {headerActions && <div className="ml-auto flex flex-shrink-0 items-center gap-1">{headerActions}</div>}
      </div>

      <div className={cn("flex min-w-0 items-center", dense ? "w-full gap-1" : "gap-2")}>
        {/* The shortcut has to be visible or it does not exist. Same Kbd the
            rest of the board hints with, and split so each key sits on the
            side it moves towards: ← before the tabs, → after them. Both
            `shrink-0`, because the row is `justify-between` and a long
            address would otherwise squeeze exactly these. Both mounts: the
            arrows walk the tabs in the panel too, and a shortcut nobody is
            told about is a shortcut nobody uses. The panel pays for them
            with a tighter gap.
            One key cap in both mounts (hill climb r11): a 24px cap with a
            14px / 1.75 stroke arrow in the secondary icon ink — the 11px
            text arrow in a 16px cap read as a disabled control. The key at
            the end it cannot pass (← on the first tab, → on the last) is a
            no-op there and wears the «unavailable» `opacity-40`; only then. */}
        <Kbd
          className={cn(TAB_ARROW_KEY, tab === OPERATION_DETAIL_TABS[0] && "opacity-40")}
          title={t('detail.tabs.switchHint')}
          aria-label={t('detail.tabs.switchHint')}
        >
          <ArrowLeft className={TAB_ARROW_ICON} strokeWidth={1.75} aria-hidden="true" />
        </Kbd>
        <TabsList className={cn(dense ? "min-w-0 flex-1" : "flex-shrink-0")}>
          <TabsTrigger value="overview" className={tabTriggerClass}>{t('detail.tabs.overview')}</TabsTrigger>
          {/* Reko stands alone: it is written and read at a different moment
              than everything the crew sends from the Schadenplatz, and one
              tab holding both was one tab nobody could see the end of. */}
          <TabsTrigger value="reko" className={tabTriggerClass}>{t('detail.tabs.reko')}</TabsTrigger>
          {/* «Feld», not «Rapport»: the panel stopped being the
              Schadenplatz-Rapport alone. It carries everything that comes
              back from `/feld` — the crew's and the driver's Freitext
              Meldungen, Angekommen und Einsatz beendet, die Abholung — and
              a tab named after one of its sections hides the rest. The
              `value` stays `rapport`: it is a deep link (`openOnTab`) and
              a notification target, not a label. */}
          <TabsTrigger value="rapport" className={tabTriggerClass}>
            {t('detail.tabs.rapport')}
            {/* Whitespace-only text nodes generate no box in a flex
                container, so this costs nothing visually and keeps the
                trigger's accessible name from reading «Feld·Rapport». */}
            {' '}
            {/* Filed and draft are mutually exclusive board flags. «Entwurf»
                is the one worth surfacing — somebody started and walked away
                — so it must not hide behind a silent tab. Nothing is shown
                when no rapport exists at all; the card already carries that.
                Both name the Rapport now: under «Feld» a bare «erfasst» no
                longer said *what* had been erfasst. */}
            {(operation.hasSchadenplatzRapport || operation.hasSchadenplatzRapportDraft) && (
              <span className="text-2xs font-normal text-muted-foreground">
                ·{' '}
                {operation.hasSchadenplatzRapport
                  ? t('detail.tabs.rapportFiled')
                  : t('detail.tabs.rapportDraft')}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className={tabTriggerClass}>{t('detail.tabs.history')}</TabsTrigger>
        </TabsList>

        <Kbd
          className={cn(TAB_ARROW_KEY, tab === OPERATION_DETAIL_TABS.at(-1) && "opacity-40")}
          title={t('detail.tabs.switchHint')}
          aria-hidden="true"
        >
          <ArrowRight className={TAB_ARROW_ICON} strokeWidth={1.75} aria-hidden="true" />
        </Kbd>
      </div>
    </header>
  )
}

"use client"

import { useTranslations } from "next-intl"
import { PageNavigation } from "@/components/page-navigation"
import { TrainingBadge } from "@/components/training-mode-chrome"
import { Badge } from "@/components/ui/badge"
import { WallClock } from "@/components/ui/event-clock"

/** The Lagekarte's top header – desktop-only; the phone uses the bottom navbar. */
export function MapPageHeader({
  training,
  shownCount,
  hasSelectedEvent,
  selectedIncidentId,
  isMobile,
}: {
  /** The Ereignis is an Übung. */
  training: boolean
  /** Shown and searched Einsätze. */
  shownCount: number
  hasSelectedEvent: boolean
  selectedIncidentId: string | null
  isMobile: boolean
}) {
  const t = useTranslations('map')
  const tKanban = useTranslations('kanban')
  return (
    <header className="hidden md:flex items-center justify-between border-b border-border bg-header px-4 md:px-6 py-2 min-h-14">
      <div className="flex items-center gap-3">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('page.title')}</h1>
        {/* The word next to the page title, in the same warning colour the
            board's event switcher uses — colour alone never carries it. */}
        {training && <TrainingBadge label={tKanban('dashboard.training')} />}
        {/* «18 Einsätze», not «18 Aktiv»: it counts every shown Einsatz, open
            ones included, and the rail's «AKTIV · 8» group is a different number. */}
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {t('page.activeBadge', { count: shownCount })}
        </Badge>
      </div>

      {/* Desktop Navigation */}
      {!isMobile && (
        <div className="flex items-center gap-4">
          {/* Ticks inside its own component — see WallClock. */}
          <WallClock />
          <PageNavigation
            currentPage="map"
            hasSelectedEvent={hasSelectedEvent}
            selectedIncidentId={selectedIncidentId}
          />
        </div>
      )}

    </header>
  )
}

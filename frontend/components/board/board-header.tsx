"use client"

import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { Plus, ChevronDown, CalendarDays } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SearchInput } from "@/components/ui/search-input"
import { EventClock } from "@/components/ui/event-clock"
import { Kbd } from "@/components/ui/kbd"
import { TrainingBadge } from "@/components/training-mode-chrome"
import { PageNavigation } from "@/components/page-navigation"
import { BoardEdgeChipBar, type useBoardEdgeOverflow } from "@/components/kanban/board-edge-chips"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { columns } from "@/lib/kanban-utils"

interface BoardHeaderProps {
  isMobile: boolean
  /** Which columns stand out of view (`useBoardEdgeOverflow` on `#kanban-main`). */
  boardEdge: ReturnType<typeof useBoardEdgeOverflow>
  /** What the board search leaves – the edge chips count these. */
  filteredOperations: Operation[]
  searchQuery: string
  setSearchQuery: (query: string) => void
  selectedOperationId: string | null
}

/**
 * The desktop board's top bar: the Ereignis title as an Ereignis switcher, the
 * chips for columns out of view, the board search, the clock and the page tabs.
 * Desktop-only – on a phone everything routes through the bottom navbar (event
 * switching lives in its "Mehr" sheet).
 */
export function BoardHeader({ isMobile, boardEdge, filteredOperations, searchQuery, setSearchQuery, selectedOperationId }: BoardHeaderProps) {
  const { isLoaded, boardNeverLoaded } = useOperations()
  const { selectedEvent, events, setSelectedEvent } = useEvent()
  const router = useRouter()
  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')

  return (
    <header className="hidden md:flex items-center justify-between gap-4 border-b border-border bg-header px-4 md:px-6 py-2 min-h-14">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Event title doubles as an event switcher: switch events or create a
            new one without first hunting through the user menu → Ereignisse. */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 min-w-0 -ml-2 rounded-lg px-2 py-1 hover:bg-secondary/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <h1 className={`text-xl md:text-2xl font-bold tracking-tight truncate ${selectedEvent ? "" : "text-muted-foreground"}`}>
              {selectedEvent ? selectedEvent.name : tDash('noEventSelected')}
            </h1>
            {/* Warning-coloured, always visible: the wall display, /alarm and
                the mobile navigation all say «Übung» in this colour, and the
                loudest signal must not sit where nobody types. */}
            {selectedEvent?.training_flag && <TrainingBadge label={tDash('training')} />}
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>{tDash('switchEvent')}</DropdownMenuLabel>
            {events
              .filter((e) => !e.archived_at && e.id !== selectedEvent?.id)
              .sort((a, b) => b.last_activity_at.getTime() - a.last_activity_at.getTime())
              .slice(0, 6)
              .map((event) => (
                <DropdownMenuItem
                  key={event.id}
                  onClick={() => setSelectedEvent(event)}
                  className="cursor-pointer"
                >
                  <span className="truncate">{event.name}</span>
                  {event.training_flag && (
                    <TrainingBadge label={tDash('training')} className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/events?action=create")} className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              {tDash('newEvent')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/events")} className="cursor-pointer">
              <CalendarDays className="mr-2 h-4 w-4" />
              {tDash('allEvents')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Columns entirely out of view (UX-DESKTOP-07): named here, in the bar's empty
            middle, instead of over the board – left ones after the Ereignis, right ones
            before the search. A click scrolls there. Gone when every column shows. */}
        {!isMobile && isLoaded && !boardNeverLoaded && (
          <BoardEdgeChipBar
            left={boardEdge.left}
            right={boardEdge.right}
            columns={columns}
            operations={filteredOperations}
            onShow={boardEdge.scrollToColumn}
          />
        )}
      </div>

      {/* Desktop Navigation */}
      {!isMobile && (
        <div className="flex items-center gap-4">
          <SearchInput
            id="search-input"
            placeholder={tCommon('search')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            // narrower below lg: at 768px the header (with the Alarmeingang icon) ran 20px over
            className="w-56 lg:w-72"
            hint={<Kbd>S</Kbd>}
          />

          <EventClock />

          <PageNavigation
            currentPage="kanban"
            hasSelectedEvent={!!selectedEvent}
            selectedIncidentId={selectedOperationId}
          />
        </div>
      )}
    </header>
  )
}

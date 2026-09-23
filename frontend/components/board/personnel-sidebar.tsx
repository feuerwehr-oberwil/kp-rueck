"use client"

/**
 * The Personen-Leiste: who is checked in for this Ereignis, «Frei» above
 * «Gebunden», with its search, the «nur verfügbare» filter, the check-in QR
 * for an empty roster, and the availability counter at the foot.
 *
 * Presentational: the board page owns every value and handler and passes them
 * in under the names it uses itself, so this JSX is the page's, moved verbatim
 * (2026-09-23). Each row's pragmatic-dnd `draggable` is DraggablePerson's own,
 * on the same element as before.
 */

import type { Dispatch, SetStateAction } from "react"
import { useTranslations } from "next-intl"
import { QRCodeSVG } from "qrcode.react"
import { Check, ChevronLeft, Copy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { SearchInput } from "@/components/ui/search-input"
import { DraggablePerson } from "@/components/kanban/draggable-person"
import { ResourcesNotLoaded } from "@/components/board-load-error"
import { AvailableOnlyToggle, BindingsPopoverBody, SidebarEmpty, SidebarLoading } from "@/components/board/sidebar-parts"
import type { BindingsPopoverState, ResourceBinding } from "@/lib/board-sidebar"
import type { Person } from "@/lib/contexts/operations-context"
import type { DoubleBookedPersons } from "@/lib/hooks/use-double-booked-persons"
import type { PersonEngagement } from "@/lib/hooks/use-person-engagements"
import type { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"
import type { summarizeRoster } from "@/lib/resource-status"

export interface PersonnelSidebarProps {
  setShowLeftSidebar: Dispatch<SetStateAction<boolean>>
  personnelSearchQuery: string
  setPersonnelSearchQuery: Dispatch<SetStateAction<string>>
  /** The board's own search — cleared when it, not the sidebar's, hides everybody. */
  setSearchQuery: Dispatch<SetStateAction<string>>
  isMobile: boolean
  personnelAvailableOnly: boolean
  setPersonnelAvailableOnly: Dispatch<SetStateAction<boolean>>
  isLoaded: boolean
  /** Loaded and failed with nothing ever shown — see `boardNeverLoaded` in the operations context. */
  boardNeverLoaded: boolean
  personnel: Person[]
  checkInUrl: string | null
  copied: boolean
  copyCheckInUrlToClipboard: () => void
  filteredPersonnel: Person[]
  effectivePersonnelQuery: string
  availabilityGroupedPersonnel: ReturnType<typeof useResourceFiltering>["availabilityGroupedPersonnel"]
  bindingsPopover: BindingsPopoverState | null
  setBindingsPopover: Dispatch<SetStateAction<BindingsPopoverState | null>>
  handlePersonClick: (person: Person) => void
  doubleBookedPersons: DoubleBookedPersons
  personEngagements: Map<string, PersonEngagement>
  followBinding: (binding: ResourceBinding) => void
  rosterSummary: ReturnType<typeof summarizeRoster>
}

export function PersonnelSidebar({
  setShowLeftSidebar,
  personnelSearchQuery,
  setPersonnelSearchQuery,
  setSearchQuery,
  isMobile,
  personnelAvailableOnly,
  setPersonnelAvailableOnly,
  isLoaded,
  boardNeverLoaded,
  personnel,
  checkInUrl,
  copied,
  copyCheckInUrlToClipboard,
  filteredPersonnel,
  effectivePersonnelQuery,
  availabilityGroupedPersonnel,
  bindingsPopover,
  setBindingsPopover,
  handlePersonClick,
  doubleBookedPersons,
  personEngagements,
  followBinding,
  rosterSummary,
}: PersonnelSidebarProps) {
  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  return (
      <aside className="relative z-10 w-64 border-r border-border bg-card/30 backdrop-blur-sm flex flex-col">
        {/* Collapse handle — small chevron centered on the sidebar's inner edge */}
        <button
          onClick={() => setShowLeftSidebar(false)}
          className="absolute right-0 top-1/2 translate-x-1/2 z-20 flex h-12 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary/60 hover:text-foreground"
          title={`${tDash('toggleLeftSidebar')} ([)`}
          aria-label={tDash('toggleLeftSidebar')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {/* Search */}
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
          <SearchInput
            id="personnel-search-input"
            size="sm"
            containerClassName="flex-1 min-w-0"
            placeholder={tDash('personnelSearch')}
            value={personnelSearchQuery}
            onValueChange={setPersonnelSearchQuery}
            className="h-8 text-sm"
            hint={!isMobile ? <Kbd>P</Kbd> : undefined}
          />
          <AvailableOnlyToggle
            active={personnelAvailableOnly}
            onToggle={() => setPersonnelAvailableOnly((v) => !v)}
            label={personnelAvailableOnly ? tDash('showAll') : tDash('showAvailableOnly')}
          />
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain pl-4 pr-2 pt-1 pb-3">
          {!isLoaded ? (
            <SidebarLoading label={tDash('personnelLoading')} />
          ) : boardNeverLoaded ? (
            <ResourcesNotLoaded label={tDash('notLoaded')} />
          ) : personnel.length === 0 ? (
            /* Nobody is checked in for this Ereignis — the QR is the way in.
               The test used to be "nobody is *available*", which meant a board
               where every checked-in person was already assigned (or driving,
               or on Reko) replaced the whole crew list with «Keine Personen
               verfügbar» and a check-in QR — hiding the very people the
               operator had just checked in, and telling them to check in
               again. Assigned people belong in the list, drawn as assigned. */
            <div className="flex flex-col items-center gap-3 py-4 animate-in fade-in duration-300">
              <p className="text-sm text-muted-foreground text-center">
                {tDash('noPersonnelCheckedIn')}
              </p>
              {checkInUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="rounded-lg border p-2 bg-white">
                    <QRCodeSVG
                      value={checkInUrl}
                      size={120}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground text-center">
                      {tDash('scanCheckInQr')}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={copyCheckInUrlToClipboard}
                      title={tCommon('copyLink')}
                    >
                      {copied ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : filteredPersonnel.length === 0 ? (
            /* Nothing to list although people ARE checked in: the search or
               the «nur Verfügbare» filter is hiding all of them. Which of
               the two it is decides what the way out is, so it decides the
               wording — a search that matches nothing used to leave a blank
               box under a footer still claiming «10/17». */
            effectivePersonnelQuery ? (
              <SidebarEmpty
                message={tDash.rich('noPersonnelMatch', {
                  query: effectivePersonnelQuery,
                  term: (chunks) => <span className="text-foreground">{chunks}</span>,
                })}
                action={tDash('resetSearch')}
                // Clear whichever field is actually driving this: the
                // sidebar's own search wins over the board's (see
                // `effectivePersonnelQuery`), so clearing the board's
                // while the sidebar holds a term would change nothing.
                onAction={() => {
                  if (personnelSearchQuery) setPersonnelSearchQuery('')
                  else setSearchQuery('')
                }}
              />
            ) : (
              <SidebarEmpty
                message={tDash('noneAvailableFiltered')}
                action={tDash('showAll')}
                onAction={() => setPersonnelAvailableOnly(false)}
              />
            )
          ) : (
            <div className="space-y-4 animate-in fade-in duration-300">
              {/* Frei first, Gebunden second — the sidebar's first job is
                  «wen kann ich noch schicken?», so availability is the
                  structure and rank is a suffix on the row. Caps, so a
                  heading can never read as a person. */}
              {([
                ['free', availabilityGroupedPersonnel.free],
                ['bound', availabilityGroupedPersonnel.bound],
              ] as const).map(([kind, people]) => people.length === 0 ? null : (
                <div key={kind}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {kind === 'free'
                      ? tDash('groupFree', { count: people.length })
                      : tDash('groupBound', { count: people.length })}
                  </h3>
                  <div className="space-y-0.5">
                    {people.map((person) => (
                      /* The row answers where the person is — completely.
                         An anchor rather than a trigger: the card keeps
                         its own click handler, which decides between a
                         direct jump and this list. */
                      <Popover
                        key={person.id}
                        open={bindingsPopover?.kind === 'person' && bindingsPopover.id === person.id}
                        onOpenChange={(open) => { if (!open) setBindingsPopover(null) }}
                      >
                        <PopoverAnchor asChild>
                          <div>
                            <DraggablePerson
                              person={person}
                              onClick={() => handlePersonClick(person)}
                              assignmentCount={doubleBookedPersons.counts.get(person.name)}
                              engagement={personEngagements.get(person.name)}
                            />
                          </div>
                        </PopoverAnchor>
                        <PopoverContent align="start" side="right" className="w-80 p-3">
                          {bindingsPopover && (
                            <BindingsPopoverBody
                              state={bindingsPopover}
                              onGo={followBinding}
                              onClose={() => setBindingsPopover(null)}
                            />
                          )}
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Fixed availability counter at bottom. No rule above it: the
            slightly lighter bar and its own padding already read as a
            separate strip, and a line there was just chrome. */}
        <div className="px-4 py-2 bg-card/50 backdrop-blur-sm">
          <p className="text-xs text-muted-foreground text-center">
            {/* Three states, three sentences. The counter used to render
                «0/0 verfügbar» before the roster had arrived and «10/17»
                over a list showing nothing — both of them assertions about
                the station that were not true at the moment they were made.
                While loading it says nothing («–/–»); while a search is
                narrowing the list it counts what is on screen. */}
            {!isLoaded || boardNeverLoaded
              ? tCommon('counterLoading')
              : effectivePersonnelQuery
                ? tCommon('visibleCounter', { shown: filteredPersonnel.length, total: personnel.length })
                : null}
          </p>
          {/* One number and its counterpart, both from the SAME predicate
              the list is filtered with (`summarizeRoster` → isPersonOccupied).
              The counter used to read `status === "available"` straight off
              the API while the list went through the helpers, so people on
              Reko, driving, in the Magazin or on Telefondienst were hidden
              above and counted as free here — «14 verfügbar» over nine
              visible rows. Deliberately NOT broken down by function: this
              is the line read in half a second, not a statistic. */}
          {isLoaded && !boardNeverLoaded && !effectivePersonnelQuery && (
            <div className="flex items-center justify-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                <Check className="size-3.5" />
                {tCommon('rosterFree', { count: rosterSummary.free })}
              </span>
              <span className="text-muted-foreground">{tCommon('rosterOf', { total: rosterSummary.total })}</span>
              {rosterSummary.bound > 0 && (
                <Badge variant="outline" className="border-amber-200 text-amber-700 dark:border-amber-800/50 dark:text-amber-400">
                  {tCommon('rosterBound', { count: rosterSummary.bound })}
                </Badge>
              )}
            </div>
          )}
        </div>
      </aside>
  )
}

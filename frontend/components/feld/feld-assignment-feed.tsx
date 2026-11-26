'use client'

import { useMemo, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { CarTaxiFront, ChevronRight, FileText, MessageSquare, Navigation, Waypoints } from 'lucide-react'

import { FeldBriefingLine } from '@/components/feld/feld-briefing'
import { FeldDanachList } from '@/components/feld/feld-danach-list'
import { LeaderLine } from '@/components/feld/feld-leader-line'
import { RapportStateChip } from '@/components/feld/feld-rapport-state-chip'
import { Button } from '@/components/ui/button'
import { IncidentNumber } from '@/components/ui/incident-number'
import { PriorityGlyph } from '@/components/ui/priority-glyph'
import { LoadingStatus } from '@/components/ui/shell-loader'
import type { ApiFeldAssignment, ApiFeldPlanned } from '@/lib/api-client'
import {
  assignmentRapportApplies,
  isLiveAssignment,
  journeyState,
  keepHouseNumber,
  owesRapport,
  rekoWindowClosed,
} from '@/lib/feld-assignment'
import { auftragColor } from '@/lib/kanban-utils'
import { navigationUrl } from '@/lib/navigation'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

/** The journey as a chip. «Vor Ort» carries the weight — it is the one of the
 *  three that means "this is what you are doing right now". */
function JourneyChip({ assignment }: { assignment: ApiFeldAssignment }) {
  const t = useTranslations('feld.assignments.journey')
  const state = journeyState(assignment)
  if (!state) return null
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
        state === 'onSite' ? 'bg-secondary font-medium text-foreground' : 'bg-muted text-muted-foreground'
      }`}
    >
      {t(state)}
    </span>
  )
}

/**
 * Why this row is in the list — shown only when that is not obvious.
 *
 * **Label the exception, not the rule.** An own assignment carries no tag at
 * all; the absence *is* the statement "this is mine". For a single-role person
 * every tag would have read the same, which is noise. Driver rows name the
 * vehicle that brought them in, because otherwise a Schadenplatz nobody
 * assigned you to is a mystery.
 */
function SourceLabel({ assignment }: { assignment: ApiFeldAssignment }) {
  const t = useTranslations('feld.source')
  if (assignment.source === 'crew') return null

  const label =
    assignment.source === 'driver'
      ? t('driver', { vehicle: assignment.source_vehicle ?? '' })
      : t(assignment.source)

  // Every source is a FACT, so every tag is the same muted chip (COL-08): blue is an
  // Auftrag's colour and amber «schau hin» – on this page that is «kein Rapport».
  return (
    <span className="inline-flex shrink-0 items-center rounded-sm bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  )
}

/** The plain sentence under a row that explains an unusual source. The label is
 *  a tag; this is the explanation, and it is what actually makes the union rule
 *  legible to somebody who never heard of it.
 *
 *  **Not for drivers.** "Das TLF ist disponiert – du bist nicht selbst
 *  zugeteilt" told the one person on the Schadenplatz who already knows why he
 *  is there, and read like a correction. The `TLF 1` tag is enough. Reko and
 *  Magazin keep theirs: "your material is still there" is the only thing that
 *  explains a row for a Schadenplatz nobody sent you to. */
function SourceReason({ assignment }: { assignment: ApiFeldAssignment }) {
  const t = useTranslations('feld.source')
  if (assignment.source !== 'reko' && assignment.source !== 'magazin') return null
  return <p className="mb-1.5 text-xs text-muted-foreground">{t(`${assignment.source}Reason`)}</p>
}

/**
 * The /feld list's rows, in feed order: «Danach» and «Früher» where the live rows end, an
 * Auftrag's heading over its stops, and per row the address, why it is here, the EL, the
 * briefing line and its chips. The page passes the sorted feed (`feedBucket`) and opens a row
 * through `onOpen`; `rekoOpening` is the Reko row whose form link is being minted.
 */
export function FeldAssignmentFeed({
  feed,
  planned,
  selfId,
  rekoOpening,
  onOpen,
}: {
  feed: readonly ApiFeldAssignment[]
  planned: readonly ApiFeldPlanned[]
  selfId: string | undefined
  rekoOpening: { incidentId: string; failed: boolean } | null
  onOpen: (assignment: ApiFeldAssignment) => void
}) {
  const t = useTranslations('feld')
  const tPickup = useTranslations('feld.pickup')

  /**
   * Which rows belong to an Auftrag, and how many stops it has.
   *
   * A crew assigned to the *route* holds no row on any stop, so their two
   * Schadenplätze arrive looking like two unrelated jobs — which is the exact
   * opposite of what an Auftrag says. The list puts them under one heading and
   * numbers them, because the order they are driven in is the reason the KP
   * grouped them in the first place.
   *
   * Counted over the whole feed rather than per render position: a stop that
   * sorted into a different bucket must still say "2 von 3", not "1 von 1".
   */
  const auftragSizes = useMemo(() => {
    const sizes = new Map<string, number>()
    for (const assignment of feed) {
      if (!assignment.group_id) continue
      sizes.set(assignment.group_id, (sizes.get(assignment.group_id) ?? 0) + 1)
    }
    return sizes
  }, [feed])

  /**
   * Which stop of each Auftrag is the job in hand.
   *
   * A route is driven in order, so exactly one of its stops is where the squad
   * is *now*: the one they have already reached, or else the earliest one still
   * live. The stops after it stay on the page — a crew wants to know what comes
   * next — but dimmed, because a route drawn in one weight makes the phone
   * answer «du hast drei Stopps» when the question was «wo bin ich».
   */
  const auftragCurrentStop = useMemo(() => {
    const best = new Map<string, { incidentId: string; position: number; arrived: boolean }>()
    for (const assignment of feed) {
      if (!assignment.group_id || !isLiveAssignment(assignment)) continue
      const candidate = {
        incidentId: assignment.incident_id,
        position: assignment.group_position ?? 0,
        arrived: Boolean(assignment.arrived_at),
      }
      const held = best.get(assignment.group_id)
      // Standing at a stop beats route order — a squad that drove past one and
      // reported «Angekommen» at the next is at the next.
      const wins =
        !held || (candidate.arrived !== held.arrived ? candidate.arrived : candidate.position < held.position)
      if (wins) best.set(assignment.group_id, candidate)
    }
    return new Map(Array.from(best, ([groupId, stop]) => [groupId, stop.incidentId]))
  }, [feed])

  return (
    <>
      {feed.map((assignment, index) => {
        const address = assignment.location_display
          ?? formatLocationForDisplay(assignment.location_address ?? '', getGlobalHomeCity())
        // The one split worth making: what is behind you. Everything above
        // is live work in the order it needs doing; below is what you have
        // already left and may still owe a Rapport for. A Reko row whose
        // window closed counts as behind you too — the KP moved on.
        const live = isLiveAssignment(assignment)
        const startsPast = !live && (index === 0 || isLiveAssignment(feed[index - 1]))
        // Behind you AND settled: nothing on this row is waiting for you.
        // It stays on the list — a crew filing at 02:00 needs to find what
        // they did — but it stops competing with the rows that are.
        const settled = !live && !owesRapport(assignment)
        // The heading opens once per Auftrag, at its first row in this feed.
        // Only when it actually has more than one stop here: a heading over
        // a single row is a label pretending to be a group.
        const auftragCount = assignment.group_id ? (auftragSizes.get(assignment.group_id) ?? 0) : 0
        const startsAuftrag =
          auftragCount > 1 &&
          (index === 0 || feed[index - 1].group_id !== assignment.group_id)
        // Where the squad is on this route, and what is still ahead of them.
        const currentStopId = assignment.group_id ? auftragCurrentStop.get(assignment.group_id) : undefined
        const isCurrentStop = auftragCount > 1 && currentStopId === assignment.incident_id
        const isLaterStop = auftragCount > 1 && live && currentStopId !== undefined && !isCurrentStop
        const rowNavigateUrl = navigationUrl(assignment)
        const stopColor = assignment.group_id ? auftragColor(assignment.group_id, assignment.group_color) : undefined
        const kpMessages = assignment.kp_messages ?? []
        const lastKpMessage = kpMessages.length > 0 ? kpMessages[kpMessages.length - 1] : null
        return (
          <div key={`group-${assignment.incident_id}`}>
          {startsPast && <FeldDanachList planned={planned} />}
          {startsPast && (
            <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('assignments.past')}
            </p>
          )}
          {startsAuftrag && (
            <div className="mb-2 mt-4 flex items-center gap-2">
              <Waypoints className="h-3.5 w-3.5 shrink-0" style={{ color: stopColor }} />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('assignments.auftrag', {
                  name: assignment.group_name ?? '',
                  count: auftragCount,
                })}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          <div className="relative">
          <button
            onClick={() => onOpen(assignment)}
            className={`w-full cursor-pointer text-left rounded-xl p-4 transition-colors ${
              live
                ? 'bg-secondary/50 hover:bg-secondary'
                : 'bg-muted/30 hover:bg-muted/50'
            } ${settled ? 'opacity-60 hover:opacity-100' : ''} ${
              isCurrentStop ? 'ring-2' : ''
            } ${isLaterStop ? 'opacity-60 hover:opacity-100' : ''}`}
            // The route's own colour (COL-04): a crew on the teal Auftrag sees teal, as on the map.
            style={isCurrentStop && stopColor ? ({ '--tw-ring-color': stopColor } as CSSProperties) : undefined}
          >
            {/* Address first, Meldung underneath — the same order the detail
                view and the board's own cards use. A crew standing on a
                street matches the street, not the dispatcher's title for it;
                the title stays as the fallback when there is no address. */}
            <div className="flex items-start justify-between gap-3 mb-1.5">
              {/* Stop number (an Auftrag's order), then the priority mark and the
                  Einsatz number before the address, as on the phone card (D3). */}
              <h3 className="flex min-w-0 items-start gap-2 font-medium leading-tight">
                {/* Which stop of the route this is. The number is the whole
                    reason a crew reads the group as an Auftrag rather than
                    a coincidence — it says what to drive to next. */}
                {startsAuftrag || (auftragCount > 1 && assignment.group_position !== null) ? (
                  <span
                    className="mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: stopColor }}
                  >
                    {(assignment.group_position ?? 0) + 1}
                  </span>
                ) : null}
                <PriorityGlyph priority={assignment.priority} size="card" className="mt-0.5" />
                <span className="min-w-0">
                  <IncidentNumber number={assignment.number} className="mr-2 text-xs" />
                  {keepHouseNumber(address || assignment.incident_title)}
                </span>
              </h3>
              <div className="flex shrink-0 items-center gap-2">
                <SourceLabel assignment={assignment} />
                <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5" />
              </div>
            </div>
            {/* Everything under the address keeps clear of the «Navigation starten» button
                laid over the row's bottom-right corner — it sat on «Du bist EL – der
                Rapport ist deine Aufgabe.» on a 393px phone (overflow sweep, 03.10.). */}
            <div className={rowNavigateUrl ? 'pr-11' : undefined}>
            {/* Why this row is here at all, in a plain sentence — the tag
                above is a marker, this is the explanation. Silent for an
                own assignment and for a driver, which need none. */}
            <SourceReason assignment={assignment} />
            {/* The EL briefing on the list, before the form is ever opened.
                Not on a Reko row: the Einsatzleiter leads the crew that
                works the Schadenplatz, and a trupp sent out to look at it
                reports back to the KP, not to them. */}
            {assignment.source !== 'reko' && (
              <LeaderLine assignment={assignment} selfId={selfId} className="mb-2" />
            )}
            {/* Meldung, Fahrzeuge, Gefahren — the three facts that decide
                which of six rows you open (§18.22). The rest of the
                briefing is one tap away and stays there. */}
            <FeldBriefingLine assignment={assignment} />
            {/* The KP's latest sentence to this squad (§P3.2), one line so
                a message is noticed without opening the row. */}
            {lastKpMessage && (
              <p className="mb-1.5 flex items-start gap-1.5 text-xs font-medium text-foreground">
                <MessageSquare className="mt-px h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">{lastKpMessage.message}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {/* Hin — dran — zurück, before anything the row owes: it is
                  what tells a finished Schadenplatz apart from the one
                  being driven to, which the list could not say at all.
                  Suppressed on a route's later stops: nobody is driving to
                  stop 3 yet, it is simply next on the list, and «Anfahrt»
                  on all of them at once says the squad is in three places.
                  The dimmed row and its number already say what those
                  stops are. */}
              {!isLaterStop && <JourneyChip assignment={assignment} />}
              {assignmentRapportApplies(assignment) && (
                <RapportStateChip state={assignment.rapport_state} />
              )}
              {/* No Schadenplatz-Status here. «Disponiert / Anfahrt», «Im
                  Einsatz» are the KP's own workflow, and a crew standing on
                  the job reads them as a claim about themselves that the
                  board happens to be a step behind on. What they owe and
                  what tapping does is the whole message. */}
              {/* «Reko erfassen» only while a Reko can still change what
                  the KP does; a closed window says so instead (item P2.6). */}
              {assignment.source === 'reko' && !rekoWindowClosed(assignment) && (
                rekoOpening?.incidentId === assignment.incident_id && !rekoOpening.failed ? (
                  <LoadingStatus className="text-xs font-medium text-foreground">{t('source.rekoOpening')}</LoadingStatus>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                    <FileText className="h-3 w-3" />
                    {t('source.rekoAction')}
                  </span>
                )
              )}
              {rekoWindowClosed(assignment) && (
                <span className="text-xs text-muted-foreground">{t('source.rekoClosed')}</span>
              )}
              {!assignment.is_active_assignment && (
                <span className="text-xs text-muted-foreground">{t('assignments.released')}</span>
              )}
              {/* An open Abholung is the one thing on this list that is
                  about the crew rather than the Schadenplatz. */}
              {assignment.pickup_needed && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                  <CarTaxiFront className="h-3 w-3" />
                  {tPickup('badge')}
                </span>
              )}
            </div>
            </div>
          </button>
          {/* Straight into the phone's maps app. Sits OVER the row rather
              than inside it: the row is a <button>, and an <a> nested in one
              is invalid markup that iOS resolves by making neither work. */}
          {rowNavigateUrl && (
            <a
              href={rowNavigateUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={event => event.stopPropagation()}
              title={t('assignments.navigate')}
              aria-label={t('assignments.navigate')}
              className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-lg bg-background/80 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <Navigation className="size-4" />
            </a>
          )}
          </div>
          {rekoOpening?.incidentId === assignment.incident_id && rekoOpening.failed && (
            <div role="alert" className="mt-1 flex items-center justify-between gap-3 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0">{t('source.rekoOpenFailed')}</span>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => onOpen(assignment)}>
                {t('sync.retry')}
              </Button>
            </div>
          )}
          </div>
        )
      })}
    </>
  )
}

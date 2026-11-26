'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MessageSquare, Navigation } from 'lucide-react'

import { FeldActions } from '@/components/feld/feld-actions'
import { FeldBriefing } from '@/components/feld/feld-briefing'
import { LeaderLine } from '@/components/feld/feld-leader-line'
import { FeldPlaceLine } from '@/components/feld/feld-place-line'
import { FeldRapportForm } from '@/components/feld/feld-rapport-form'
import { RapportStateChip } from '@/components/feld/feld-rapport-state-chip'
import { PhotoViewerProvider } from '@/components/photos/photo-viewer'
import { IncidentNumber } from '@/components/ui/incident-number'
import { PriorityGlyph } from '@/components/ui/priority-glyph'
import {
  apiClient,
  type ApiFeldAssignment,
  type ApiFieldReportState,
  type ApiSchadenplatzRapport,
} from '@/lib/api-client'
import {
  assignmentRapportApplies,
  einsatzartLine,
  incidentHasRapport,
  keepHouseNumber,
} from '@/lib/feld-assignment'
import { formatTime } from '@/lib/format-time'
import { getIncidentTypeLabel } from '@/lib/incident-types'
import { navigationUrl } from '@/lib/navigation'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

/** Whether the briefing's «Mannschaft» already marks the EL (`FeldBriefing` matches by name). */
function leaderInCrew(assignment: ApiFeldAssignment): boolean {
  return !!assignment.leader_name && assignment.crew.includes(assignment.leader_name)
}

/**
 * One Schadenplatz on /feld, under the page's identity bar: the place line, the header card
 * (address, Einsatzart, EL, the crew's times, the briefing), the field actions, «Meldungen vom
 * KP» and the Rapport. `token` and `personnelId` are the door; without both the sections that
 * write stay off. The page folds what the sections report back into its list.
 */
export function FeldDetail({
  assignment,
  personnelId,
  token,
  messageChips,
  driverMessageChips,
  requestMaterials,
  onSent,
  onReported,
  onRapportSaved,
}: {
  assignment: ApiFeldAssignment
  personnelId: string | undefined
  token: string | null
  messageChips: string[]
  driverMessageChips: string[]
  requestMaterials: string[]
  /** A Meldung or request was delivered (`FeldActions` `onSent`). */
  onSent: () => void
  onReported: (state: ApiFieldReportState) => void
  onRapportSaved: (rapport: ApiSchadenplatzRapport) => void
}) {
  const t = useTranslations('feld')
  const tRapport = useTranslations('feld.rapport')
  // The fixed footer's slot for the Rapport form's «Rapport abschliessen» (FeldActions hands
  // it over on the Rapport step; null while the footer shows another step or none).
  const [rapportSubmitSlot, setRapportSubmitSlot] = useState<HTMLDivElement | null>(null)
  // The detail's address heading — when it has scrolled under the top bar,
  // `FeldPlaceLine` takes its place (owner pick 2A, 24.11.2026).
  const placeHeaderRef = useRef<HTMLDivElement>(null)

  // Server label first (final on first paint), client formatting only as the
  // fallback for a payload that predates it — same as everywhere else.
  const address = assignment.location_display
    ?? formatLocationForDisplay(assignment.location_address ?? '', getGlobalHomeCity())
  const navigateUrl = navigationUrl(assignment)
  // The house number stays with its street: «Mühlemattstrasse / 18» never.
  const headline = keepHouseNumber(address || assignment.incident_title)
  return (
    <div className="max-w-md mx-auto p-4">
      {/* «6  Goldenthalweg 21 · Elementarereignis» under the top bar once
          the header below has scrolled away. Zero height in the flow. */}
      <FeldPlaceLine
        number={assignment.number}
        address={headline}
        type={getIncidentTypeLabel(assignment.incident_type)}
        headerRef={placeHeaderRef}
      />

      {/* The detail is a STACK OF SECTIONS, not one form: plans 13 and 24
          mount here too, and the later phases of plan 25 add the actions,
          the Rapport form, the material checklist and the photos as further
          sections rather than a rewrite. */}
      <div className="space-y-4">
        {/* Section: header — what and where, then the briefing */}
        <section className="rounded-xl bg-secondary/50 p-4">
          {/* The headline has the card's full width: the rapport chip beside it
              squeezed «Mühlemattstrasse 18» onto two lines and wrapped
              itself to «kein / Rapport» (after-shots, 14.11.2026). */}
          <div ref={placeHeaderRef} className="mb-2">
            {/* The page's h1. The address leads because that is what a crew
                standing on a street matches against; the Einsatzart and the
                title follow on the line under it. */}
            {/* Tappable: the next thing that happens after reading this is
                somebody drives, and re-typing a street name into another app
                one-handed is both slow and the easiest place all night to
                fat-finger it. Falls back to plain text when the Schadenplatz
                has neither a pin nor an address — see `lib/navigation.ts`. */}
            {/* 18/600: the heaviest line on the page, above the EL briefing.
                Priority mark + number before the address, as on the phone
                Einsatz sheet and every other surface (owner pick D3): the
                shared mark in its own column (18px box, centred on the 22px
                first line), the number 12/500 mono inline, 8px to the
                address. The navigation glyph trails the address now – before
                it, it stood between the priority mark and the number. */}
            <h1 className="flex min-w-0 items-start gap-2 text-lg font-semibold leading-tight">
              <PriorityGlyph priority={assignment.priority} size="wall" className="mt-0.5 size-[18px]" />
              {navigateUrl ? (
                // A flex box, not inline text: the phone's 44px touch floor
                // (globals.css) only takes on a box. The number is
                // `inline-block` so the link's underline stays on the address.
                <a
                  href={navigateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-start gap-1.5 underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                >
                  <span className="min-w-0 break-words">
                    <IncidentNumber number={assignment.number} className="mr-2 inline-block text-xs" />
                    {headline}
                  </span>
                  <Navigation className="mt-[3px] h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
              ) : (
                <span className="min-w-0 break-words">
                  <IncidentNumber number={assignment.number} className="mr-2 text-xs" />
                  {headline}
                </span>
              )}
            </h1>
          </div>
          {/* «Diverse Einsätze · Türöffnung» — what kind of job this is, and
              the dispatcher's title when it says more than the headline —
              with the rapport chip on the same line, wrapping under it as a
              whole when the line is full. */}
          <div className="mb-2 -mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="min-w-0 break-words text-sm text-muted-foreground">
              {einsatzartLine(
                getIncidentTypeLabel(assignment.incident_type),
                assignment.incident_title,
                address || assignment.incident_title,
              )}
            </p>
            {/* No chip on a Schadenplatz nobody was ever sent to: "kein
                Rapport" would read as a to-do the crew cannot do. */}
            {assignmentRapportApplies(assignment) && (
              <RapportStateChip state={assignment.rapport_state} />
            )}
          </div>
          {/* The EL line only when the briefing below does not name the EL already (6C,
              phone sweep 24.11.2026): «Mannschaft» marks them with the board's sign, and
              the header said it a second time. A finished Schadenplatz has released its
              crew, and «kein EL erfasst» is said nowhere else – those keep the line. */}
          {assignment.source !== 'reko' && !leaderInCrew(assignment) && (
            <LeaderLine assignment={assignment} selfId={personnelId} className="mb-2" />
          )}
          {/* The crew's own timestamps. The board's status («KP: Im Einsatz»,
              sweep 27 §P3.1) is gone again (owner, 14.11.2026): the KP's
              workflow word read as a claim about the crew, and the answer a
              squad waits for is in «Angefordert» and «Meldungen vom KP». */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground empty:hidden">
            {assignment.arrived_at && (
              <span>
                {/* Said differently when the automation saw it (§18.24), so
                    a crew that never tapped "Angekommen" does not read the
                    line as somebody's report. */}
                {t(
                  assignment.arrived_by_automation ? 'detail.arrivedAtAuto' : 'detail.arrivedAt',
                  { time: formatTime(assignment.arrived_at) },
                )}
              </span>
            )}
            {assignment.field_complete_reported_at && (
              <span>
                {t('detail.completeAt', { time: formatTime(assignment.field_complete_reported_at) })}
              </span>
            )}
            {/* The same sentence the list row carries, because the detail
                is where somebody sits while the KP closes the Schadenplatz
                under them. Without it the only sign was a row that had
                quietly moved to «Früher» on a list they were not looking
                at — the status itself is the KP's workflow and stays off
                this page. */}
            {!assignment.is_active_assignment && (
              <span>{t('assignments.released')}</span>
            )}
          </div>

          {/* The briefing lives IN the header, under the address it is
              about (§18.22). It used to be a card of its own titled "Lage
              und Ressourcen" — a heading over the only thing on screen,
              separating the Meldung from the address it describes. */}
          <div className="mt-3 border-t border-border/60 pt-3">
            <FeldBriefing assignment={assignment} bare />
          </div>
        </section>

        {/* Section: field actions — Angekommen / Einsatz beendet /
            Abholung / Meldung. Fotos join them in phase 3.

            They stay directly under the header, above the briefing: they
            are what a crew does with one wet thumb, and the briefing is
            reading. "A phone in the rain gets one tap, not a scroll." */}
        {token && personnelId && (
          <FeldActions
            assignment={assignment}
            personnelId={personnelId}
            token={token}
            messageChips={assignment.source === 'driver' ? driverMessageChips : messageChips}
            requestMaterials={requestMaterials}
            // A sent request shows up in «Angefordert» at once, not on the next poll.
            onSent={onSent}
            onReported={onReported}
            // The journey's third step: the footer holds the form's own
            // «Rapport abschliessen» – only when that form is actually
            // mounted on this page.
            rapportSubmitSlot={assignmentRapportApplies(assignment) ? setRapportSubmitSlot : undefined}
          />
        )}

        {/* Section: «Meldungen vom KP» (sweep 27 §P3.2) — the other half of
            the Meldung loop. On the KP's side a field Meldung is an urgent
            toast; here the KP's sentence gets the one tinted card on the
            page, directly under the actions it usually answers. Newest
            last, thread order — same rule as the KP's own thread. */}
        {(assignment.kp_messages?.length ?? 0) > 0 && (
          <section className="rounded-xl border border-border bg-muted/60 p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
              {t('kpMessages.title')}
            </h2>
            <ol className="space-y-2">
              {(assignment.kp_messages ?? []).map(kpMessage => (
                <li key={kpMessage.id} className="text-sm">
                  <p className="text-xs text-muted-foreground">
                    {t('kpMessages.from', {
                      name: kpMessage.author_name,
                      time: formatTime(kpMessage.created_at),
                    })}
                  </p>
                  <p className="break-words">{kpMessage.message}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Section: the Schadenplatz-Rapport itself — the paper
            replacement. The SAME component the board's detail mounts
            (decision 28); only the transport and the identity differ. */}
        {/* Nothing was ever sent here, so there is nothing to report on
            (§18.27). One sentence instead of a form: the crew reads why the
            fields are missing rather than filling an empty rapport that
            lands on the Restliste as work somebody has to check. */}
        {token && personnelId && assignment.source === 'crew' && !incidentHasRapport(assignment) && (
          <section className="rounded-xl bg-secondary/30 p-4">
            <h2 className="type-label mb-2 text-muted-foreground">{t('detail.rapportTitle')}</h2>
            <p className="text-sm text-muted-foreground">{tRapport('notDispatched')}</p>
          </section>
        )}
        {token && personnelId && assignmentRapportApplies(assignment) && (
          <section className="space-y-3">
            <h2 className="type-label px-1 text-muted-foreground">{t('detail.rapportTitle')}</h2>
            {/* The Rapport's photos open in a viewer of their own; it loads them
                through the feld door below (`photos.url`, logged with `view=full`). */}
            <PhotoViewerProvider incidentLabel={headline}>
              <FeldRapportForm
                key={assignment.incident_id}
                incidentId={assignment.incident_id}
                submitSlot={rapportSubmitSlot}
                transport={{
                  load: () =>
                    apiClient.getFeldRapport(assignment.incident_id, personnelId, token),
                  save: update =>
                    apiClient.saveFeldRapport(
                      assignment.incident_id,
                      personnelId,
                      token,
                      update,
                    ),
                  // Same storage as the Reko form, a different door: the feld
                  // two-step, never a widened form token.
                  photos: {
                    upload: async (file, onProgress) =>
                      (
                        await apiClient.uploadFeldPhoto(
                          assignment.incident_id,
                          personnelId,
                          token,
                          file,
                          onProgress,
                        )
                      ).filename ?? '',
                    remove: async filename => {
                      await apiClient.deleteFeldPhoto(
                        assignment.incident_id,
                        personnelId,
                        token,
                        filename,
                      )
                    },
                    // Reading is a door too. The board's photo endpoint wants
                    // a session and this page has none, so its `<img>` came
                    // back 401 — one crew, its own photo, a broken icon.
                    url: filename =>
                      apiClient.feldPhotoUrl(
                        assignment.incident_id,
                        personnelId,
                        token,
                        filename,
                      ),
                  },
                }}
                onSaved={onRapportSaved}
              />
            </PhotoViewerProvider>
          </section>
        )}
      </div>
    </div>
  )
}

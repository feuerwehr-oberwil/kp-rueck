'use client'

/**
 * `/feld` — the field surface (plan 25, phases 0-1).
 *
 * One login-less page per Ereignis: everyone in the field finds themselves in a
 * list and sees exactly their own Schadenplätze. Phase 0 built the door; phase 1
 * hangs the four actions on it (Angekommen · Einsatz beendet · Abholung ·
 * Meldung). The detail view stays a STACK OF SECTIONS, so the remaining phases
 * (the Rapport form, the material checklist, photos — and plans 13 and 24, which
 * mount here too) each add a section instead of rewriting a page.
 *
 * Mobile is the viewport that matters here. KP Rück is a desktop board, but the
 * field pages are the exception — this one is read on a phone in the rain.
 */

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft, CarTaxiFront, CheckCircle2, ChevronRight, Clock, FileText, MapPin, Star, User } from 'lucide-react'

import {
  apiClient,
  type ApiFeldPersonnel,
  type ApiFeldAssignment,
  type ApiFieldReportState,
  type ApiSchadenplatzRapport,
} from '@/lib/api-client'
import { FeldActions } from '@/components/feld/feld-actions'
import { FeldBriefing, FeldBriefingLine } from '@/components/feld/feld-briefing'
import { FeldRapportForm } from '@/components/feld/feld-rapport-form'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { topLoading } from '@/components/ui/top-loading-bar'
import { getActiveLocale } from '@/lib/i18n-messages'
import { rapportApplies } from '@/lib/rapport-visibility'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

type ViewMode = 'list' | 'assignments' | 'detail'

/** Who this phone belongs to, and which Schadenplatz it was last looking at.
 *  Both are per DEVICE, not per session: the page is login-less, a phone locks
 *  itself in a pocket, and Safari drops a background tab whenever it wants —
 *  none of which should cost the crew their place. Path-scoped to `/feld`. */
const PERSON_COOKIE = 'feld-selected-person'
const INCIDENT_COOKIE = 'feld-selected-incident'
const COOKIE_EXPIRY_DAYS = 7

/**
 * How often the field list refetches while the tab is visible.
 *
 * Twice the board's ~5 s, because the two surfaces answer different questions:
 * an operator watches forty cards move, a crew looks at one address between two
 * jobs. Ten seconds is well inside "I glanced at it and it was right" and halves
 * the requests from a phone on mobile data.
 */
const FELD_POLL_MS = 10000

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? match[2] : null
}

function writeCookie(name: string, value: string) {
  const expires = new Date()
  expires.setDate(expires.getDate() + COOKIE_EXPIRY_DAYS)
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/feld`
}

function clearCookie(name: string) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld`
}

function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
}

/**
 * The EL briefing (decision 22): every `/feld` surface names the Einsatzleiter
 * of that Schadenplatz BEFORE the form opens, so a crew knows who is normally
 * expected to file. Briefed, never enforced — anybody assigned may still file.
 * The empty case reads "kein EL erfasst"; it is never a blank line.
 */
function LeaderLine({
  assignment,
  selfId,
  className,
}: {
  assignment: ApiFeldAssignment
  selfId: string | undefined
  className?: string
}) {
  const t = useTranslations('feld.leader')
  const isSelf = Boolean(assignment.leader_personnel_id && assignment.leader_personnel_id === selfId)

  if (isSelf) {
    return (
      <p className={`flex items-start gap-1.5 text-sm font-medium text-primary ${className ?? ''}`}>
        <Star className="h-3.5 w-3.5 mt-0.5 shrink-0 fill-current" />
        <span>{t('self')}</span>
      </p>
    )
  }

  return (
    <p className={`flex items-start gap-1.5 text-sm text-muted-foreground ${className ?? ''}`}>
      <Star className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{assignment.leader_name ? t('label', { name: assignment.leader_name }) : t('none')}</span>
    </p>
  )
}

/** Does this row owe a rapport at all? (§18.27) — the one place `/feld` asks,
 *  so the chip and the form section can never disagree with each other. */
function assignmentRapportApplies(assignment: ApiFeldAssignment): boolean {
  return rapportApplies({
    hasBeenDispatched: assignment.has_been_dispatched,
    status: assignment.incident_status,
    hasReport: assignment.rapport_state !== 'none',
  })
}

function RapportStateChip({ state }: { state: ApiFeldAssignment['rapport_state'] }) {
  const t = useTranslations('feld.rapportState')
  const styles: Record<ApiFeldAssignment['rapport_state'], string> = {
    none: 'bg-muted text-muted-foreground',
    draft: 'bg-warning/15 text-warning',
    submitted: 'bg-success/15 text-success',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles[state]}`}>
      {state === 'submitted' ? <CheckCircle2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
      {t(state)}
    </span>
  )
}

export default function FeldPage() {
  // `useSearchParams` needs a boundary to prerender against — same shape as
  // /alarm. The fallback is empty on purpose: load activity is the global top
  // bar, not a spinner in the middle of the page.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <FeldSurface />
    </Suspense>
  )
}

function FeldSurface() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  // The Einsatzzettel's second QR (decision 19): the SAME event token with the
  // incident appended. A shortcut, not a second door — it can only preselect the
  // Schadenplatz, never the person, because the slip is printed before it is
  // known who drives. So the picker (or the cookie) still decides who you are,
  // and this only skips the "meine Einsatzstellen" tap afterwards.
  const preselectIncidentId = searchParams.get('incident_id')
  const t = useTranslations('feld')
  const tCommon = useTranslations('reko.common')
  const tStatus = useTranslations('kanban.statusLabels')
  const tPickup = useTranslations('feld.pickup')
  const tRapport = useTranslations('feld.rapport')

  const [personnel, setPersonnel] = useState<ApiFeldPersonnel[]>([])
  const [selectedPerson, setSelectedPerson] = useState<ApiFeldPersonnel | null>(null)
  const [assignments, setAssignments] = useState<ApiFeldAssignment[]>([])
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [eventName, setEventName] = useState<string>('')
  // Station-configurable Freitext chips (decision 20), served with the list.
  const [messageChips, setMessageChips] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingAssignments, setLoadingAssignments] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const restoredFromCookie = useRef(false)
  const restoredIncident = useRef(false)
  const preselectApplied = useRef(false)

  // Load activity goes through the global top bar, not inline spinners — the
  // page shows nothing but the bar, then content fades in.
  useEffect(() => {
    if (!loading) return
    topLoading.start()
    return () => topLoading.done()
  }, [loading])
  useEffect(() => {
    if (!loadingAssignments) return
    topLoading.start()
    return () => topLoading.done()
  }, [loadingAssignments])

  const loadPersonnel = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiClient.getFeldPersonnel(token)
      setPersonnel(data.personnel)
      setEventName(data.event_name)
    } catch (err) {
      console.error('Failed to load field personnel:', err)
      setError(t('invalidCode'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  /**
   * ``silent`` is what the poll passes: no top loading bar, and a failed
   * request keeps the list it already had.
   *
   * Both halves matter on a phone. A progress bar flashing across the top every
   * ten seconds is a page that looks permanently busy; and a poll that missed
   * one request in a cellar must not blank out the Schadenplatz the crew is
   * standing at — the stale list is right far more often than an empty one.
   * A deliberate load (picking a person, coming back to the tab) keeps both.
   */
  const loadAssignments = useCallback(async (personnelId: string, options?: { silent?: boolean }) => {
    if (!token) return
    const silent = options?.silent === true
    if (!silent) setLoadingAssignments(true)
    try {
      const data = await apiClient.getFeldAssignments(personnelId, token)
      setAssignments(data.assignments)
      setMessageChips(data.message_chips ?? [])
    } catch (err) {
      console.error('Failed to load field assignments:', err)
      if (!silent) setAssignments([])
    } finally {
      if (!silent) setLoadingAssignments(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      setError(t('missingCode'))
      setLoading(false)
      return
    }
    loadPersonnel()
  }, [token, loadPersonnel, t])

  const handleSelectPerson = useCallback(async (person: ApiFeldPersonnel) => {
    setSelectedPerson(person)
    setViewMode('assignments')
    setAssignments([])
    setSelectedIncidentId(null)
    writeCookie(PERSON_COOKIE, person.personnel_id)
    await loadAssignments(person.personnel_id)
  }, [loadAssignments])

  /** Open a Schadenplatz and remember it, so a reload comes back HERE. */
  const openAssignment = useCallback((incidentId: string) => {
    setSelectedIncidentId(incidentId)
    setViewMode('detail')
    writeCookie(INCIDENT_COOKIE, incidentId)
  }, [])

  /** Leaving via «Zurück» is the crew saying they are done with this one, so it
   *  is also what forgets it — otherwise the back button would be undone by the
   *  next reload. */
  const leaveAssignment = useCallback(() => {
    setViewMode('assignments')
    setSelectedIncidentId(null)
    clearCookie(INCIDENT_COOKIE)
  }, [])

  // Restore the person from the cookie once the picker has loaded: the crew
  // scans the poster once and lands on their own list from then on.
  useEffect(() => {
    if (restoredFromCookie.current || loading || personnel.length === 0) return
    const savedId = readCookie(PERSON_COOKIE)
    if (!savedId) return
    const person = personnel.find(p => p.personnel_id === savedId)
    if (person) {
      restoredFromCookie.current = true
      handleSelectPerson(person)
    }
  }, [personnel, loading, handleSelectPerson])

  // ...and then back into the Schadenplatz it was open on. Same one-shot rule as
  // the slip preselect below, and for the same reason: the 10 s poll replaces
  // `assignments` continuously, and a restore that fired on every replacement
  // would drag the crew back into the detail view each time they left it.
  // A slip in the URL outranks the memory — somebody just scanned it.
  useEffect(() => {
    if (restoredIncident.current || preselectIncidentId || assignments.length === 0) return
    restoredIncident.current = true
    const savedId = readCookie(INCIDENT_COOKIE)
    if (!savedId) return
    // Gone from the list (reassigned, event over, wrong person on this phone):
    // forget it rather than leave a pointer to a page we cannot show.
    if (!assignments.some(a => a.incident_id === savedId)) {
      clearCookie(INCIDENT_COOKIE)
      return
    }
    setSelectedIncidentId(savedId)
    setViewMode('detail')
  }, [assignments, preselectIncidentId])

  // Jump straight to the Schadenplatz the scanned slip names — once. The visibility
  // refetch below replaces `assignments` on every focus, and a preselect that fired
  // again there would drag the crew back out of whatever they had navigated to.
  // A slip for an incident that is not on this person's list simply lands them on
  // their own list, which is the honest answer: visibility is "only mine".
  useEffect(() => {
    if (preselectApplied.current || !preselectIncidentId || assignments.length === 0) return
    preselectApplied.current = true
    const match = assignments.find(a => a.incident_id === preselectIncidentId)
    if (!match) return
    openAssignment(match.incident_id)
  }, [assignments, preselectIncidentId, openAssignment])

  // Coming back from another tab/app should show the current state, not what
  // the board looked like when the phone went into the pocket.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      if (selectedPerson && token) loadAssignments(selectedPerson.personnel_id)
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [selectedPerson, token, loadAssignments])

  /**
   * Live updates — **polling, deliberately, not the WebSocket**.
   *
   * `/feld` had no live path at all: a crew watched a page that never changed
   * until it reloaded. Not a pickup the KP cleared, not a rapport a colleague
   * filed, not an arrival, and — worst — not a new Schadenplatz they had just
   * been assigned to, while the empty state promises "sobald du eingeteilt
   * bist, erscheint sie hier".
   *
   * The socket was the other candidate and was rejected. It requires a JWT in
   * the `access_token` cookie (`ws_require_auth`), so serving this page would
   * mean teaching the socket a second identity: a token that is **printed on a
   * poster on a wall**. That turns a login-less read surface into a persistent
   * authenticated server connection whose credential cannot be revoked from the
   * people holding it — a new failure mode, in exchange for a few seconds of
   * latency on a screen somebody looks at between two hose lines. Polling is
   * what the board itself already falls back to, it cannot leak anything, and
   * its bad-connection behaviour is understood.
   *
   * Two rules keep it cheap: it runs **only while the tab is visible** (a phone
   * in a pocket is the normal state of this page, and it must not poll from
   * there), and it goes through the same `loadAssignments` as everything else —
   * so the server-side "visibility is only mine" two-step is unchanged and no
   * new door was opened for this.
   */
  useEffect(() => {
    if (!selectedPerson || !token) return
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      loadAssignments(selectedPerson.personnel_id, { silent: true })
    }
    const interval = setInterval(tick, FELD_POLL_MS)
    return () => clearInterval(interval)
  }, [selectedPerson, token, loadAssignments])

  const handleNotMe = () => {
    setSelectedPerson(null)
    setViewMode('list')
    setAssignments([])
    setSelectedIncidentId(null)
    setSearchTerm('')
    clearCookie(PERSON_COOKIE)
    clearCookie(INCIDENT_COOKIE)
    restoredFromCookie.current = false
    restoredIncident.current = false
    // The phone is being handed to whoever actually drove. If they scanned a
    // slip, that slip still names the Schadenplatz — so the preselect gets
    // another turn for the next person.
    preselectApplied.current = false
    loadPersonnel()
  }

  const filteredPersonnel = useMemo(() => {
    const sorted = [...personnel].sort((a, b) => a.name.localeCompare(b.name, getActiveLocale()))
    const term = searchTerm.trim().toLowerCase()
    if (!term) return sorted
    return sorted.filter(p => p.name.toLowerCase().includes(term) || (p.role ?? '').toLowerCase().includes(term))
  }, [personnel, searchTerm])

  const selectedAssignment = useMemo(
    () => assignments.find(a => a.incident_id === selectedIncidentId) ?? null,
    [assignments, selectedIncidentId],
  )

  /**
   * Fold the server's answer to a field action back into the list row.
   *
   * Merged locally rather than refetched: the crew is on a phone at the edge of
   * coverage, and a full round trip after every tap is the one thing that makes
   * a big button feel like it did not work.
   */
  const applyFieldReport = useCallback((state: ApiFieldReportState) => {
    setAssignments(prev =>
      prev.map(a =>
        a.incident_id === state.incident_id
          ? {
              ...a,
              arrived_at: state.arrived_at,
              arrived_by_automation: state.arrived_by_automation,
              field_complete_reported_at: state.field_complete_reported_at,
              pickup_needed: state.pickup_needed,
              pickup_note: state.pickup_note,
              pickup_requested_at: state.pickup_requested_at,
            }
          : a,
      ),
    )
  }, [])

  /**
   * Fold a rapport save back into the list row's state chip.
   *
   * Same reason as `applyFieldReport`: the crew is on a phone at the edge of
   * coverage, and a refetch after every autosave is what makes a big form feel
   * like it did not work.
   */
  const applyRapportState = useCallback((rapport: ApiSchadenplatzRapport) => {
    setAssignments(prev =>
      prev.map(a =>
        a.incident_id === rapport.incident_id
          ? { ...a, rapport_state: rapport.is_draft ? 'draft' : 'submitted', arrived_at: rapport.arrived_at }
          : a,
      ),
    )
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-destructive text-xl font-semibold mb-2">{t('accessRequired')}</div>
          <div className="text-muted-foreground">{error}</div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- list
  if (viewMode === 'list') {
    return (
      <div className="min-h-screen bg-background p-4 pb-20">
        <div className="max-w-md mx-auto mb-6">
          <h1 className="text-2xl font-semibold text-center mb-1">{t('title')}</h1>
          {eventName && <p className="text-sm text-muted-foreground text-center">{eventName}</p>}
          <p className="text-sm text-muted-foreground text-center mt-3">{t('picker.description')}</p>
        </div>

        <div className="max-w-md mx-auto">
          <SearchInput
            value={searchTerm}
            onValueChange={setSearchTerm}
            placeholder={t('picker.searchPlaceholder')}
            size="lg"
            containerClassName="mb-4"
          />

          <div className="space-y-3">
            {loading ? null : filteredPersonnel.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground animate-in fade-in duration-300">
                {personnel.length === 0 ? t('picker.empty') : t('picker.noneFound')}
              </div>
            ) : (
              filteredPersonnel.map(person => (
                <button
                  key={person.personnel_id}
                  onClick={() => handleSelectPerson(person)}
                  className="w-full cursor-pointer flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
                >
                  <div className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center bg-muted">
                    <User className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{person.name}</div>
                    {person.role && <div className="text-sm text-muted-foreground truncate">{person.role}</div>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-sm font-medium">
                      {t('picker.incidentCount', { count: person.incident_count })}
                    </div>
                    {person.missing_rapport_count > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t('picker.missingRapport', { count: person.missing_rapport_count })}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------- detail
  if (viewMode === 'detail' && selectedAssignment) {
    // Server label first (final on first paint), client formatting only as the
    // fallback for a payload that predates it — same as everywhere else.
    const address = selectedAssignment.location_display
      ?? formatLocationForDisplay(selectedAssignment.location_address ?? '', getGlobalHomeCity())
    return (
      <div className="min-h-screen bg-background pb-20">
        {/* The address, always on screen. Folded blocks mean a crew can be four
            taps deep in a Rapport with nothing left in view that says WHICH
            Schadenplatz they are filing — and on a storm night there are six.
            So the way back and the address ride along at the top. */}
        <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-md items-center gap-1 px-2 py-2">
            <Button variant="ghost" size="sm" onClick={leaveAssignment} className="shrink-0">
              <ArrowLeft className="size-3.5" />
              {tCommon('back')}
            </Button>
            {/* Still the page's h1 — it only moved into the bar, so the heading
                a screen reader announces is the one that is always on screen. */}
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={selectedAssignment.incident_title}>
              {selectedAssignment.incident_title}
            </h1>
          </div>
        </div>

        <div className="max-w-md mx-auto p-4">

          {/* The detail is a STACK OF SECTIONS, not one form: plans 13 and 24
              mount here too, and the later phases of plan 25 add the actions,
              the Rapport form, the material checklist and the photos as further
              sections rather than a rewrite. */}
          <div className="space-y-4">
            {/* Section: header — what and where, plus the EL briefing */}
            <section className="rounded-xl bg-secondary/50 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                {/* The address leads the card: the incident title is in the
                    sticky bar above and does not need saying twice. */}
                <p className="flex items-start gap-1.5 text-base font-semibold leading-tight">
                  {address && <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                  <span>{address || selectedAssignment.incident_title}</span>
                </p>
                {/* No chip on a Schadenplatz nobody was ever sent to: "kein
                    Rapport" would read as a to-do the crew cannot do. */}
                {assignmentRapportApplies(selectedAssignment) && (
                  <RapportStateChip state={selectedAssignment.rapport_state} />
                )}
              </div>
              <LeaderLine assignment={selectedAssignment} selfId={selectedPerson?.personnel_id} className="mb-2" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{tStatus(selectedAssignment.incident_status)}</span>
                {selectedAssignment.arrived_at && (
                  <span>
                    {/* Said differently when the automation saw it (§18.24), so
                        a crew that never tapped "Angekommen" does not read the
                        line as somebody's report. */}
                    {t(
                      selectedAssignment.arrived_by_automation ? 'detail.arrivedAtAuto' : 'detail.arrivedAt',
                      { time: formatTime(selectedAssignment.arrived_at) },
                    )}
                  </span>
                )}
                {selectedAssignment.field_complete_reported_at && (
                  <span>
                    {t('detail.completeAt', { time: formatTime(selectedAssignment.field_complete_reported_at) })}
                  </span>
                )}
              </div>
            </section>

            {/* Section: field actions — Angekommen / Einsatz beendet /
                Abholung / Meldung. Fotos join them in phase 3.

                They stay directly under the header, above the briefing: they
                are what a crew does with one wet thumb, and the briefing is
                reading. "A phone in the rain gets one tap, not a scroll." */}
            {token && selectedPerson && (
              <FeldActions
                assignment={selectedAssignment}
                personnelId={selectedPerson.personnel_id}
                token={token}
                messageChips={messageChips}
                onReported={applyFieldReport}
              />
            )}

            {/* Section: the briefing (§18.22) — what the board knows about
                this Schadenplatz. Read-only, and it sits above the Rapport
                because it is what the crew fills the Rapport against. */}
            <FeldBriefing assignment={selectedAssignment} folded />

            {/* Section: the Schadenplatz-Rapport itself — the paper
                replacement. The SAME component the board's detail mounts
                (decision 28); only the transport and the identity differ. */}
            {/* Nothing was ever sent here, so there is nothing to report on
                (§18.27). One sentence instead of a form: the crew reads why the
                fields are missing rather than filling an empty rapport that
                lands on the Restliste as work somebody has to check. */}
            {token && selectedPerson && !assignmentRapportApplies(selectedAssignment) && (
              <section className="rounded-xl bg-secondary/30 p-4">
                <h2 className="text-sm font-medium mb-2">{t('detail.rapportTitle')}</h2>
                <p className="text-sm text-muted-foreground">{tRapport('notDispatched')}</p>
              </section>
            )}
            {token && selectedPerson && assignmentRapportApplies(selectedAssignment) && (
              <section className="space-y-3">
                <h2 className="px-1 text-sm font-medium text-muted-foreground">{t('detail.rapportTitle')}</h2>
                <FeldRapportForm
                  key={selectedAssignment.incident_id}
                  incidentId={selectedAssignment.incident_id}
                  transport={{
                    load: () =>
                      apiClient.getFeldRapport(selectedAssignment.incident_id, selectedPerson.personnel_id, token),
                    save: update =>
                      apiClient.saveFeldRapport(
                        selectedAssignment.incident_id,
                        selectedPerson.personnel_id,
                        token,
                        update,
                      ),
                    // Same storage as the Reko form, a different door: the feld
                    // two-step, never a widened form token.
                    photos: {
                      upload: async file =>
                        (
                          await apiClient.uploadFeldPhoto(
                            selectedAssignment.incident_id,
                            selectedPerson.personnel_id,
                            token,
                            file,
                          )
                        ).filename ?? '',
                      remove: async filename => {
                        await apiClient.deleteFeldPhoto(
                          selectedAssignment.incident_id,
                          selectedPerson.personnel_id,
                          token,
                          filename,
                        )
                      },
                      // Reading is a door too. The board's photo endpoint wants
                      // a session and this page has none, so its `<img>` came
                      // back 401 — one crew, its own photo, a broken icon.
                      url: filename =>
                        apiClient.feldPhotoUrl(
                          selectedAssignment.incident_id,
                          selectedPerson.personnel_id,
                          token,
                          filename,
                        ),
                    },
                  }}
                  onSaved={applyRapportState}
                />
              </section>
            )}
          </div>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------- assignments
  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      <div className="max-w-md mx-auto mb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">{selectedPerson?.name}</h1>
              <p className="text-sm text-muted-foreground truncate">{selectedPerson?.role || eventName}</p>
            </div>
          </div>
          {/* "Nicht ich" — the phone gets handed around; the cookie must be one
              tap away from being wrong about who is holding it. */}
          <Button variant="ghost" size="sm" onClick={handleNotMe} className="shrink-0">
            {t('assignments.notMe')}
          </Button>
        </div>
      </div>

      <div className="max-w-md mx-auto space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t('assignments.title')}</h2>

        {loadingAssignments ? null : assignments.length === 0 ? (
          <div className="py-12 text-center animate-in fade-in duration-300">
            <div className="h-12 w-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
            {/* Visibility is "only mine" and it is enforced server-side, so a
                crew redirected by radio genuinely cannot file until the KP
                assigns them. This sentence is the whole mitigation for that
                decision — an empty page without it turns a policy into a bug
                report. */}
            <p className="text-sm text-muted-foreground px-2">{t('assignments.empty')}</p>
          </div>
        ) : (
          assignments.map(assignment => {
            const address = assignment.location_display
              ?? formatLocationForDisplay(assignment.location_address ?? '', getGlobalHomeCity())
            return (
              <button
                key={assignment.incident_id}
                onClick={() => openAssignment(assignment.incident_id)}
                className={`w-full cursor-pointer text-left rounded-xl p-4 transition-colors ${
                  assignment.is_active_assignment
                    ? 'bg-secondary/50 hover:bg-secondary'
                    : 'bg-muted/30 hover:bg-muted/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <h3 className="font-medium leading-tight">{assignment.incident_title}</h3>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </div>
                {address && <p className="text-sm text-muted-foreground mb-1.5">{address}</p>}
                {/* The EL briefing on the list, before the form is ever opened. */}
                <LeaderLine assignment={assignment} selfId={selectedPerson?.personnel_id} className="mb-2" />
                {/* Meldung, Fahrzeuge, Gefahren — the three facts that decide
                    which of six rows you open (§18.22). The rest of the
                    briefing is one tap away and stays there. */}
                <FeldBriefingLine assignment={assignment} />
                <div className="flex flex-wrap items-center gap-2">
                  {assignmentRapportApplies(assignment) && (
                    <RapportStateChip state={assignment.rapport_state} />
                  )}
                  <span className="text-xs text-muted-foreground">{tStatus(assignment.incident_status)}</span>
                  {!assignment.is_active_assignment && (
                    <span className="text-xs text-muted-foreground">{t('assignments.released')}</span>
                  )}
                  {/* An open Abholung is the one thing on this list that is
                      about the crew rather than the Schadenplatz. */}
                  {assignment.pickup_needed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                      <CarTaxiFront className="h-3 w-3" />
                      {tPickup('badge')}
                    </span>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

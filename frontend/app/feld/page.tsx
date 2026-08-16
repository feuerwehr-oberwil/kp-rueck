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
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft, CarTaxiFront, CheckCircle2, ChevronRight, Clock, FileText, MapPin, Plus, Star, User } from 'lucide-react'

import {
  apiClient,
  type ApiFeldPersonnel,
  type ApiFeldAssignment,
  type ApiFieldReportState,
  type ApiSchadenplatzRapport,
} from '@/lib/api-client'
import { FeldActions } from '@/components/feld/feld-actions'
import { FeldBriefing, FeldBriefingLine } from '@/components/feld/feld-briefing'
import { FeldIdentityBar, clearFeldName, writeFeldName } from '@/components/feld/feld-identity-bar'
import { FeldMeldenSheet } from '@/components/feld/feld-melden-sheet'
import { FeldRapportForm } from '@/components/feld/feld-rapport-form'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SearchInput } from '@/components/ui/search-input'
import { topLoading } from '@/components/ui/top-loading-bar'
import { getActiveLocale } from '@/lib/i18n-messages'
import { rapportApplies } from '@/lib/rapport-visibility'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

/** `code` is the door (plan 26): the link alone opens nothing, so the page asks
 *  for the four digits before it can even show the picker. A device that has
 *  already been through it skips straight to `assignments`. */
type ViewMode = 'code' | 'list' | 'assignments' | 'detail'

/**
 * The four buckets the feed sorts into, strongest first (plan 26 §3).
 *
 * **Fixed order, not a computed score.** The whole design leans on the crew
 * being able to explain the list in four words — jetzt · Rapport fehlt ·
 * unterwegs · offen — and bucket 2 is load-bearing: a Schadenplatz somebody has
 * already left, still owing a Rapport, must never sort below a newer task. That
 * is the requirement the whole surface exists for.
 */
function feedBucket(assignment: ApiFeldAssignment): number {
  if (assignment.is_active_assignment && assignment.arrived_at) return 0 // jetzt: standing there
  if (owesRapport(assignment)) return 1 // abgerückt, aber offen
  if (assignment.is_active_assignment) return 2 // unterwegs
  return 3
}

/** Still owes one: the rapport applies here (which already means it is a crew
 *  row) and nobody has filed it yet. This is bucket 2 of the feed — the reason
 *  a Schadenplatz somebody has already left stays near the top. */
function owesRapport(assignment: ApiFeldAssignment): boolean {
  return assignment.rapport_state !== 'submitted' && assignmentRapportApplies(assignment)
}

/** Who this phone belongs to, and which Schadenplatz it was last looking at.
 *  Both are per DEVICE, not per session: the page is login-less, a phone locks
 *  itself in a pocket, and Safari drops a background tab whenever it wants —
 *  none of which should cost the crew their place. Path-scoped to `/feld`. */
const PERSON_COOKIE = 'feld-selected-person'
const INCIDENT_COOKIE = 'feld-selected-incident'
/** The device's own token, earned by entering the Feld-Code and naming yourself
 *  (plan 26, decisions 13 and 18). From here on this is the credential the page
 *  uses — the token in the URL is spent and never sent again. Storing it is what
 *  stops the crew re-typing the code every time the tab is dropped. */
const TOKEN_COOKIE = 'feld-device-token'
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

/**
 * Does this SCHADENPLATZ have a Rapport at all? (§18.27)
 *
 * About the incident, not about who is looking at it: nobody was ever sent
 * here, so there is nothing to report on.
 */
function incidentHasRapport(assignment: ApiFeldAssignment): boolean {
  return rapportApplies({
    hasBeenDispatched: assignment.has_been_dispatched,
    status: assignment.incident_status,
    hasReport: assignment.rapport_state !== 'none',
  })
}

/**
 * Is the Rapport **this person's** to file?
 *
 * Two questions, deliberately separate. Folding them into one told a driver
 * standing at a long-dispatched Schadenplatz that it "wird erst erfasst, wenn
 * der Schadenplatz disponiert wurde" — the right answer to a question nobody
 * had asked, and a visibly false statement about the incident.
 *
 * Only a `crew` row owes one (plan 26, decision 11): a driver parked outside
 * and a Reko trupp that only looked owe nothing, and the server refuses the
 * write — so the form must not be offered either.
 */
function assignmentRapportApplies(assignment: ApiFeldAssignment): boolean {
  return assignment.source === 'crew' && incidentHasRapport(assignment)
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

  const tone =
    assignment.source === 'driver'
      ? 'bg-info/15 text-info'
      : assignment.source === 'reko'
        ? 'bg-warning/15 text-warning'
        : 'bg-muted text-muted-foreground'

  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {label}
    </span>
  )
}

/** The plain sentence under a row that explains an unusual source. The label is
 *  a tag; this is the explanation, and it is what actually makes the union rule
 *  legible to somebody who never heard of it. */
function SourceReason({ assignment }: { assignment: ApiFeldAssignment }) {
  const t = useTranslations('feld.source')
  if (assignment.source === 'crew') return null
  return (
    <p className="mb-1.5 text-xs text-muted-foreground">
      {assignment.source === 'driver'
        ? t('driverReason', { vehicle: assignment.source_vehicle ?? '' })
        : t(`${assignment.source}Reason`)}
    </p>
  )
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
  const router = useRouter()
  const linkToken = searchParams.get('token')
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
  const [viewMode, setViewMode] = useState<ViewMode>('code')
  /**
   * The token this device actually uses.
   *
   * Starts as null and becomes, in turn, the unlocked token (the code was
   * right) and then the bound one (a person was named). The link token from the
   * URL is never used again after the exchange — that is the whole point of
   * decision 13: holding the link stops being enough.
   */
  const [deviceToken, setDeviceToken] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  // "Nicht ich" is not just a name change any more: it throws away the device's
  // bound token, so the next person types the code. Worth asking first — on a
  // wet phone it sits one thumb-width from the rest of the header.
  const [confirmNotMe, setConfirmNotMe] = useState(false)
  const [meldenOpen, setMeldenOpen] = useState(false)
  // Attendance: the individual half of the roll call (decision 10). The door
  // tablet stays its own page; this is somebody saying "ich bin da" from the
  // vehicle, and — the part that was missing entirely — "ich rücke ab".
  const [checkedIn, setCheckedIn] = useState(false)
  const [attendanceBusy, setAttendanceBusy] = useState(false)
  const token = deviceToken
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

  /**
   * Back to the door: forget the device token, the person and the place.
   *
   * Two callers, and they are the same event from opposite ends — the crew
   * handing the phone on ("nicht ich"), and the KP logging every device out
   * from the board. Either way this device is nobody until it types the code
   * again, which is exactly what the bound token was for.
   */
  const forgetDevice = useCallback(() => {
    setDeviceToken(null)
    setSelectedPerson(null)
    setPersonnel([])
    setAssignments([])
    setSelectedIncidentId(null)
    setSearchTerm('')
    setViewMode('code')
    clearCookie(TOKEN_COOKIE)
    clearCookie(PERSON_COOKIE)
    clearCookie(INCIDENT_COOKIE)
    clearFeldName()
    restoredFromCookie.current = false
    restoredIncident.current = false
    // The phone is being handed to whoever actually drove. If they scanned a
    // slip, that slip still names the Schadenplatz — so the preselect gets
    // another turn for the next person.
    preselectApplied.current = false
  }, [])

  /**
   * Step 2 of the door: trade the link token plus the four digits for an
   * unlocked one, and get the picker back in the same response.
   *
   * A wrong code is a red box and nothing else — no hint about where the code
   * lives. Whoever is standing here just scanned the poster it is printed on.
   */
  const submitCode = useCallback(async () => {
    if (!linkToken || codeInput.length < 4 || unlocking) return
    setUnlocking(true)
    setCodeError(false)
    try {
      const data = await apiClient.unlockFeld(linkToken, codeInput)
      setDeviceToken(data.token)
      setPersonnel(data.personnel)
      setEventName(data.event_name)
      setViewMode('list')
      setCodeInput('')
    } catch (err) {
      console.error('Feld unlock failed:', err)
      setCodeError(true)
      setCodeInput('')
    } finally {
      setUnlocking(false)
    }
  }, [linkToken, codeInput, unlocking])

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
  const loadAssignments = useCallback(async (
    personnelId: string,
    options?: { silent?: boolean; token?: string },
  ) => {
    const activeToken = options?.token ?? token
    if (!activeToken) return
    const silent = options?.silent === true
    if (!silent) setLoadingAssignments(true)
    try {
      const data = await apiClient.getFeldAssignments(personnelId, activeToken)
      setAssignments(data.assignments)
      setMessageChips(data.message_chips ?? [])
      setEventName(data.event_name)
      setCheckedIn(Boolean(data.checked_in))
      // A device coming back from its cookie has no picker to have chosen from,
      // so the person is restored from the response it was going to fetch
      // anyway — one round trip, not two, and no picker for somebody who has
      // already said who they are.
      setSelectedPerson(prev => prev ?? {
        personnel_id: data.personnel_id,
        name: data.personnel_name,
        role: data.personnel_role,
        incident_count: data.assignments.length,
        open_count: data.assignments.filter(a => a.is_active_assignment).length,
        missing_rapport_count: data.assignments.filter(owesRapport).length,
      })
    } catch (err) {
      console.error('Failed to load field assignments:', err)
      // 401 means this device was logged out from the board ("alle Geräte
      // abmelden"). The credential is gone, so the honest move is back to the
      // code — not an empty list that looks like "you have nothing to do".
      if (err instanceof Error && err.message.includes('401')) {
        forgetDevice()
        return
      }
      // A 403 is the server saying this list is not ours to see — the one
      // failure a stale list must NOT survive. Everything else keeps its rows
      // on a silent poll, because a cellar losing one request must not blank
      // the Schadenplatz somebody is standing at.
      if (err instanceof Error && err.message.includes('403')) {
        setAssignments([])
        return
      }
      if (!silent) setAssignments([])
    } finally {
      if (!silent) setLoadingAssignments(false)
    }
  }, [token, forgetDevice])

  // The one decision on mount: has this device already been through the door?
  // A stored token means yes, and it goes straight to the list — the code is
  // asked once per device, not once per visit.
  useEffect(() => {
    if (!linkToken) {
      setError(t('missingCode'))
      setLoading(false)
      return
    }
    const storedToken = readCookie(TOKEN_COOKIE)
    const storedPerson = readCookie(PERSON_COOKIE)
    if (storedToken && storedPerson) {
      setDeviceToken(storedToken)
      setViewMode('assignments')
      loadAssignments(storedPerson, { token: storedToken })
    } else {
      setViewMode('code')
    }
    setLoading(false)
    // Mount only: re-running this on every `loadAssignments` identity change
    // would drag a crew back out of whatever they had navigated to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkToken, t])

  /**
   * Step 3 of the door: this device is that person from now on.
   *
   * The claim is what turns an unlocked token into a bound one, and it is the
   * whole of decision 18 — after this the server refuses to let this device act
   * as anybody else, so the picker is not a security boundary, it is a
   * convenience on top of one.
   */
  const handleSelectPerson = useCallback(async (person: ApiFeldPersonnel) => {
    if (!token) return
    try {
      const claim = await apiClient.claimFeldPerson(token, person.personnel_id)
      setDeviceToken(claim.token)
      writeCookie(TOKEN_COOKIE, claim.token)
      writeCookie(PERSON_COOKIE, person.personnel_id)
      // Readable from /reko too, so the form keeps saying who is filing.
      writeFeldName(person.name)
      setSelectedPerson(person)
      setViewMode('assignments')
      setAssignments([])
      setSelectedIncidentId(null)
      await loadAssignments(person.personnel_id, { token: claim.token })
    } catch (err) {
      console.error('Feld claim failed:', err)
      setError(t('invalidCode'))
    }
  }, [token, loadAssignments, t])

  /**
   * Open a Schadenplatz and remember it, so a reload comes back HERE.
   *
   * **A Reko auftrag skips the detail page entirely** and goes straight into the
   * form, exactly as the old per-incident Reko link did. The KP sent this person
   * out to look at one place and report back — there is nothing else for them to
   * do here, so a page of Aktionen and a Rapport section is a page of things
   * that are not theirs. (The server agrees: half those buttons would 403.)
   */
  const openAssignment = useCallback(async (assignment: ApiFeldAssignment) => {
    if (assignment.source === 'reko' && token && selectedPerson) {
      try {
        const { link } = await apiClient.mintFeldRekoLink(
          assignment.incident_id,
          selectedPerson.personnel_id,
          token,
        )
        router.push(link)
      } catch (err) {
        console.error('Failed to open the reko form:', err)
      }
      return
    }
    setSelectedIncidentId(assignment.incident_id)
    setViewMode('detail')
    writeCookie(INCIDENT_COOKIE, assignment.incident_id)
  }, [token, selectedPerson, router])

  /** Leaving via «Zurück» is the crew saying they are done with this one, so it
   *  is also what forgets it — otherwise the back button would be undone by the
   *  next reload. */
  const leaveAssignment = useCallback(() => {
    setViewMode('assignments')
    setSelectedIncidentId(null)
    clearCookie(INCIDENT_COOKIE)
  }, [])

  // (The person is no longer restored from the picker: since plan 26 a returning
  // device holds a *bound* token and the mount effect above uses it directly, so
  // there is nothing to look up and no picker to look it up in.)

  // Back into the Schadenplatz it was open on. Same one-shot rule as
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
    openAssignment(match)
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

  /** Say you are here, or that you have gone home. */
  const toggleAttendance = useCallback(async () => {
    if (!token || !selectedPerson || attendanceBusy) return
    setAttendanceBusy(true)
    const next = !checkedIn
    try {
      await apiClient.setFeldAttendance(selectedPerson.personnel_id, token, next)
      setCheckedIn(next)
    } catch (err) {
      console.error('Attendance toggle failed:', err)
    } finally {
      setAttendanceBusy(false)
    }
  }, [token, selectedPerson, checkedIn, attendanceBusy])

  /** "Nicht ich" — the phone is being handed on. Switching person means a new
   *  bound token, and a new bound token means the code again: the binding would
   *  be a polite request rather than a rule if it could be shrugged off here. */
  const handleNotMe = () => forgetDevice()

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
   * The feed: one list, sorted by what is next (plan 26, decision 8).
   *
   * Not grouped by role and not tabbed, because most people in the field carry
   * exactly one role and chrome that organises *many* things is chrome they
   * never use. The server already ordered within each bucket (still-assigned
   * first, then the board's own kanban order), so this only applies the four
   * buckets on top and leaves ties alone.
   */
  const feed = useMemo(
    () => [...assignments].sort((a, b) => feedBucket(a) - feedBucket(b)),
    [assignments],
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

  // ---------------------------------------------------------------- code
  // Four boxes and one button. No explanation of where the code lives: whoever
  // is standing here scanned the poster it is printed under two seconds ago,
  // and the one screen somebody reads in the rain is not the place for a
  // paragraph. The hint appears only when they get it wrong.
  if (viewMode === 'code') {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-center p-6">
        <div className="mx-auto w-full max-w-xs">
          <h1 id="feld-code-title" className="mb-8 text-center text-2xl font-semibold">
            {t('code.title')}
          </h1>

          {/* Labelled BY the heading rather than carrying a second, invisible
              copy of the same words — one accessible name, not two. */}
          <input
            id="feld-code"
            aria-labelledby="feld-code-title"
            // A phone must open the number pad for this, and a browser must not
            // offer to remember it like a password.
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={4}
            value={codeInput}
            autoFocus
            onChange={event => {
              setCodeInput(event.target.value.replace(/\D/g, '').slice(0, 4))
              setCodeError(false)
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') submitCode()
            }}
            className={`w-full rounded-xl border-2 bg-muted px-4 py-5 text-center text-4xl font-semibold tracking-[0.4em] tabular-nums outline-none transition-colors ${
              codeError ? 'border-destructive' : 'border-border focus:border-primary'
            }`}
          />

          {codeError && (
            <p className="mt-3 text-center text-sm font-medium text-destructive">{t('code.wrong')}</p>
          )}

          <Button
            size="lg"
            className="mt-6 w-full"
            disabled={codeInput.length < 4 || unlocking}
            onClick={submitCode}
          >
            {t('code.submit')}
          </Button>
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
        {/* The identity rides along here too. Somebody four taps deep in a
            Rapport, on a phone that gets handed around a vehicle, must be able
            to answer "whose page is this" without going back for it. */}
        <FeldIdentityBar name={selectedPerson?.name ?? ''} subtitle={selectedAssignment.incident_title}>
          <Button variant="ghost" size="sm" onClick={leaveAssignment} className="shrink-0 -ml-1">
            <ArrowLeft className="size-3.5" />
            {tCommon('back')}
          </Button>
        </FeldIdentityBar>

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
                {/* The page's h1. The address leads because that is what a crew
                    standing on a street matches against; the incident title
                    rides in the bar above and is not said twice. */}
                <h1 className="flex items-start gap-1.5 text-base font-semibold leading-tight">
                  {address && <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                  <span>{address || selectedAssignment.incident_title}</span>
                </h1>
                {/* No chip on a Schadenplatz nobody was ever sent to: "kein
                    Rapport" would read as a to-do the crew cannot do. */}
                {assignmentRapportApplies(selectedAssignment) && (
                  <RapportStateChip state={selectedAssignment.rapport_state} />
                )}
              </div>
              {selectedAssignment.source !== 'reko' && (
                <LeaderLine assignment={selectedAssignment} selfId={selectedPerson?.personnel_id} className="mb-2" />
              )}
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

              {/* The briefing lives IN the header, under the address it is
                  about (§18.22). It used to be a card of its own titled "Lage
                  und Ressourcen" — a heading over the only thing on screen,
                  separating the Meldung from the address it describes. */}
              <div className="mt-3 border-t border-border/60 pt-3">
                <FeldBriefing assignment={selectedAssignment} bare />
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



            {/* Section: the Schadenplatz-Rapport itself — the paper
                replacement. The SAME component the board's detail mounts
                (decision 28); only the transport and the identity differ. */}
            {/* Nothing was ever sent here, so there is nothing to report on
                (§18.27). One sentence instead of a form: the crew reads why the
                fields are missing rather than filling an empty rapport that
                lands on the Restliste as work somebody has to check. */}
            {token && selectedPerson && selectedAssignment.source === 'crew' && !incidentHasRapport(selectedAssignment) && (
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
    <div className="min-h-screen bg-background pb-20">
      <FeldIdentityBar
        name={selectedPerson?.name ?? ''}
        subtitle={selectedPerson?.role || eventName}
        onNotMe={() => setConfirmNotMe(true)}
      />

      <div className="max-w-md mx-auto space-y-3 p-4">
        {/* Not here yet: the one thing worth a full-width button, because it is
            what somebody arriving does before anything else exists for them. */}
        {!checkedIn && (
          <section className="rounded-xl bg-secondary/60 p-4">
            <p className="mb-3 text-base font-semibold">{t('attendance.notHereTitle')}</p>
            <Button size="lg" className="w-full" onClick={toggleAttendance} disabled={attendanceBusy}>
              {t('attendance.checkIn')}
            </Button>
          </section>
        )}

        {loadingAssignments ? null : assignments.length === 0 ? (
          <div className="py-12 text-center animate-in fade-in duration-300">
            <div className="h-12 w-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
            {/* Checked in with nothing to do is NOT the same as being unknown —
                and saying so is the whole reason the picker may now be the
                roster (decision 10). It answers the question actually being
                asked: wissen die überhaupt, dass ich da bin? */}
            {checkedIn && (
              <p className="mb-2 text-base font-medium">{t('attendance.hereNoJob')}</p>
            )}
            {/* Visibility is "only mine" and it is enforced server-side, so a
                crew redirected by radio genuinely cannot file until the KP
                assigns them. This sentence is the whole mitigation for that
                decision — an empty page without it turns a policy into a bug
                report. */}
            <p className="text-sm text-muted-foreground px-2">{t('assignments.empty')}</p>
          </div>
        ) : (
          feed.map((assignment, index) => {
            const address = assignment.location_display
              ?? formatLocationForDisplay(assignment.location_address ?? '', getGlobalHomeCity())
            // The one split worth making: what is behind you. Everything above
            // is live work in the order it needs doing; below is what you have
            // already left and may still owe a Rapport for.
            const startsPast = !assignment.is_active_assignment && (index === 0 || feed[index - 1].is_active_assignment)
            return (
              <div key={`group-${assignment.incident_id}`}>
              {startsPast && (
                <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('assignments.past')}
                </p>
              )}
              <button
                onClick={() => openAssignment(assignment)}
                className={`w-full cursor-pointer text-left rounded-xl p-4 transition-colors ${
                  assignment.is_active_assignment
                    ? 'bg-secondary/50 hover:bg-secondary'
                    : 'bg-muted/30 hover:bg-muted/50'
                }`}
              >
                {/* Address first, Meldung underneath — the same order the detail
                    view and the board's own cards use. A crew standing on a
                    street matches the street, not the dispatcher's title for it;
                    the title stays as the fallback when there is no address. */}
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <h3 className="font-medium leading-tight">{address || assignment.incident_title}</h3>
                  <div className="flex shrink-0 items-center gap-2">
                    <SourceLabel assignment={assignment} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5" />
                  </div>
                </div>
                {/* Why this row is here at all, in a plain sentence — the tag
                    above is a marker, this is the explanation. Silent for an
                    own assignment, which needs none. */}
                <SourceReason assignment={assignment} />
                {/* The EL briefing on the list, before the form is ever opened.
                    Not on a Reko row: the Einsatzleiter leads the crew that
                    works the Schadenplatz, and a trupp sent out to look at it
                    reports back to the KP, not to them. */}
                {assignment.source !== 'reko' && (
                  <LeaderLine assignment={assignment} selfId={selectedPerson?.personnel_id} className="mb-2" />
                )}
                {/* Meldung, Fahrzeuge, Gefahren — the three facts that decide
                    which of six rows you open (§18.22). The rest of the
                    briefing is one tap away and stays there. */}
                <FeldBriefingLine assignment={assignment} />
                <div className="flex flex-wrap items-center gap-2">
                  {assignmentRapportApplies(assignment) && (
                    <RapportStateChip state={assignment.rapport_state} />
                  )}
                  {/* A Reko row says what it IS and what tapping does, and drops
                      the status: "Reko" as a Schadenplatz-Status next to a Reko
                      auftrag is the same word twice meaning two things. */}
                  {assignment.source === 'reko' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <FileText className="h-3 w-3" />
                      {t('source.rekoAction')}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{tStatus(assignment.incident_status)}</span>
                  )}
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
              </div>
            )
          })
        )}

        {/* The other end of the night. Quiet, at the bottom, out of the way of
            the work — but present, because "ich rücke ab" had no home at all
            and the KP was left guessing who was still out. */}
        {checkedIn && (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2.5">
            <span className="size-2 shrink-0 rounded-full bg-success" />
            <span className="flex-1 text-xs text-muted-foreground">{t('attendance.here')}</span>
            <Button variant="ghost" size="sm" onClick={toggleAttendance} disabled={attendanceBusy}>
              {t('attendance.checkOut')}
            </Button>
          </div>
        )}
      </div>

      {/* «＋ Melden» — the crew reporting something they are standing in front
          of. A floating button because it is the one action on this page that
          is not about a row: it belongs to the person, not to a Schadenplatz. */}
      {token && selectedPerson && (
        <>
          <button
            type="button"
            onClick={() => setMeldenOpen(true)}
            className="fixed bottom-5 right-4 z-40 flex h-13 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg"
          >
            <Plus className="size-4" />
            {t('melden.fab')}
          </button>
          <FeldMeldenSheet
            open={meldenOpen}
            onOpenChange={setMeldenOpen}
            personnelId={selectedPerson.personnel_id}
            token={token}
            onReported={() => loadAssignments(selectedPerson.personnel_id)}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmNotMe}
        onOpenChange={setConfirmNotMe}
        title={t('assignments.notMeTitle')}
        description={t('assignments.notMeDescription')}
        confirmText={t('assignments.notMe')}
        onConfirm={handleNotMe}
      />
    </div>
  )
}

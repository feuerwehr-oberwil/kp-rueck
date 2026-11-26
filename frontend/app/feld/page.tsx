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
import { useEffectEvent } from '@/lib/hooks/use-effect-event'
import { useHistoryLevel } from '@/lib/hooks/use-history-level'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft } from 'lucide-react'

import {
  apiClient,
  FeldUnlockError,
  NetworkError,
  type ApiFeldPersonnel,
  type ApiFeldUnlockResponse,
  type ApiFeldAssignment,
} from '@/lib/api-client'
import { FeldAssignmentFeed } from '@/components/feld/feld-assignment-feed'
import { FeldCheckIn, useFeldCheckIn } from '@/components/feld/feld-check-in'
import { FeldDanachList } from '@/components/feld/feld-danach-list'
import { FeldDetail } from '@/components/feld/feld-detail'
import { FeldEmptyFeed } from '@/components/feld/feld-empty-feed'
import { FELD_COOKIE_SCOPE, readDeviceToken, useFeldDoor } from '@/components/feld/feld-door'
import { FeldIdentityBar, clearFeldName, formatEventDay, writeFeldName } from '@/components/feld/feld-identity-bar'
import { useFeldLoad, useFeldRefresh } from '@/components/feld/feld-load'
import { FeldMaterialSection } from '@/components/feld/feld-material-section'
import { useFeldMelden } from '@/components/feld/feld-melden'
import { FeldPersonPicker } from '@/components/feld/feld-person-picker'
import { FeldReportsList } from '@/components/feld/feld-reports-list'
import { Button } from '@/components/ui/button'
import { topLoading } from '@/components/ui/top-loading-bar'
import { useBootGate } from '@/lib/boot-cover'
import { clearCookie, readCookie, writeCookie } from '@/lib/cookie'
import { useIntlLocale } from '@/lib/date-locale'
import { withReturnTo } from '@/lib/own-path'
import { formatTime } from '@/lib/format-time'
import {
  decodeFeldCredential,
  feedBucket,
  isLiveAssignment,
  owesRapport,
  rekoWindowClosed,
} from '@/lib/feld-assignment'
import { ApiError } from '@/lib/api/types/common'

/** `code` is the door (plan 26): the link alone opens nothing, so the page asks
 *  for the four digits before it can even show the picker. A device that has
 *  already been through it skips straight to `assignments`. */
type ViewMode = 'code' | 'list' | 'assignments' | 'detail'

/** Who this phone belongs to, and which Schadenplatz it was last looking at.
 *  Both are per DEVICE, not per session: the page is login-less, a phone locks
 *  itself in a pocket, and Safari drops a background tab whenever it wants —
 *  none of which should cost the crew their place. Path-scoped to `/feld`. */
const PERSON_COOKIE = 'feld-selected-person'
const INCIDENT_COOKIE = 'feld-selected-incident'

/** The empty list a field reads before the first answer: one instance, so memos keep. */
const NONE: never[] = []

export default function FeldPage() {
  // `useSearchParams` needs a boundary to prerender against — same shape as
  // /alarm. The fallback is empty on purpose: load activity is the global top
  // bar, not a spinner in the middle of the page.
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
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

  const [personnel, setPersonnel] = useState<ApiFeldPersonnel[]>([])
  const [selectedPerson, setSelectedPerson] = useState<ApiFeldPersonnel | null>(null)
  const {
    feld,
    setFeld,
    loadingAssignments,
    syncedAt,
    syncFailed,
    materials,
    load,
    lastAsked,
    reset: resetList,
    applyFieldReport,
    applyRapportState,
  } = useFeldLoad()
  const assignments = feld?.assignments ?? NONE
  // «Danach» (owner pick 5C): shown after the live rows, before «Früher».
  const planned = feld?.planned ?? NONE
  // Station-configurable Freitext chips (decision 20), served with the list.
  // Two sets: what a crew radios in, and what a DRIVER does — a driver may not
  // report «Angekommen» or «Einsatz beendet» at all, so «fertig in ~30 Min»
  // is not their sentence. The row's source picks, not the person's roles.
  const messageChips = feld?.message_chips ?? NONE
  const driverMessageChips = feld?.driver_message_chips ?? NONE
  // «Material nötig» picks from the station's material names (R13).
  const requestMaterials = feld?.request_materials ?? NONE
  // Which roles this person holds here. The roles are data (decision 5); which
  // sections they unlock stays code, deliberately.
  const functions = feld?.functions ?? NONE
  /** The vehicles this person drives here. Named, not just counted: see below. */
  const driverVehicles = feld?.driver_vehicles ?? NONE
  /**
   * What this person has REPORTED — not what they were given to work on.
   *
   * Without «wir übernehmen das gleich» a Meldung vanishes the moment it is
   * sent: it belongs to no Schadenplatz of theirs, so the visibility union
   * correctly refuses it, and a wrong house number was only fixable by radio.
   * This list is the other half of that sentence.
   */
  const reports = feld?.reports ?? NONE
  // Attendance: the individual half of the roll call (decision 10). The door
  // tablet stays its own page; this is somebody saying "ich bin da" from the
  // vehicle, and — the part that was missing entirely — "ich rücke ab".
  const checkedIn = Boolean(feld?.checked_in)
  // Their own plan (#3): «Ich komme um …» before they are in, «Ich bin da bis …» after.
  const planFrom = feld?.planned_from ?? null
  const planUntil = feld?.planned_until ?? null
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  // The unlock names the Ereignis before any list is in; the list's answer wins after.
  const [doorEventName, setDoorEventName] = useState<string>('')
  const eventName = feld?.event_name ?? doorEventName
  const eventStartedAt = feld?.event_started_at ?? null
  const intlLocale = useIntlLocale()
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  // A launch onto /feld stays behind the snail until the door has decided (code screen,
  // picker or the list) and the crew's Aufträge are in — then the page appears complete.
  const tLoading = useTranslations('common')
  useBootGate('feld', !loading && !loadingAssignments, tLoading('loading'))
  const [error, setError] = useState<string | null>(null)
  /** Whether the error screen offers a way back. A missing token has none —
   *  there is no page behind it — but a failed claim does: the picker is still
   *  right there, and a dead end is the wrong answer to "das Netz war kurz weg". */
  const [errorRecoverable, setErrorRecoverable] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('code')
  /** The Reko row being opened: its form link is minted first, which can take a moment or fail. */
  const [rekoOpening, setRekoOpening] = useState<{ incidentId: string; failed: boolean } | null>(null)
  /** Counts Reko opens: a link that comes back after a forget or a newer open goes nowhere. */
  const rekoAttempt = useRef(0)
  /** The vehicles as one readable string — «TLF 1» or «TLF 1, MTW». */
  const drivenVehicles = driverVehicles.join(', ')
  /**
   * What this person was given for THIS Ereignis, at the top of the name menu.
   *
   * Not `personnel.role` — that is the rank on the roster («Gruppenführer») and
   * it is the same at every Ereignis. The line that matters on a phone is the
   * one that says what the KP gave *you tonight*, and for a driver that is a
   * vehicle name. Falls back to the rank. In the menu rather than under the
   * name since 14.11.2026: the header's second line is the Ereignis and its
   * day, and the header stays one row high.
   */
  const roleLine = [
    drivenVehicles ? t('roles.driver', { vehicle: drivenVehicles }) : null,
    ...(['reko', 'telefondienst', 'magazin', 'kommandoposten'] as const).map(role =>
      functions.includes(role) ? t(`roles.${role}`) : null,
    ),
  ]
    .filter(Boolean)
    .join(' · ')
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
   * The page's half of going back to the door (`forget` in `useFeldDoor` drops
   * the token and the code): the person, the place and what was loaded for them.
   */
  const forgetPersonAndPlace = useCallback(() => {
    setSelectedPerson(null)
    setPersonnel([])
    setSelectedIncidentId(null)
    setSearchTerm('')
    setViewMode('code')
    resetList()
    setRekoOpening(null)
    rekoAttempt.current += 1
    clearCookie(PERSON_COOKIE, FELD_COOKIE_SCOPE)
    clearCookie(INCIDENT_COOKIE, FELD_COOKIE_SCOPE)
    clearFeldName()
    restoredFromCookie.current = false
    restoredIncident.current = false
    // The phone is being handed to whoever actually drove. If they scanned a
    // slip, that slip still names the Schadenplatz — so the preselect gets
    // another turn for the next person.
    preselectApplied.current = false
  }, [resetList])

  /** An unlock (the code, or a Rück session) brings the picker with it. */
  const showPicker = useCallback((unlock: ApiFeldUnlockResponse) => {
    setPersonnel(unlock.personnel)
    setDoorEventName(unlock.event_name)
    setViewMode('list')
  }, [])

  const {
    deviceToken: token,
    admit,
    refuse,
    forget: forgetDevice,
    askNotMe,
    codeScreen,
    notMeDialog,
  } = useFeldDoor({ linkToken, atDoor: viewMode === 'code', onUnlocked: showPicker, onForget: forgetPersonAndPlace })

  /** Load this person's list with the door's token (or the one just handed over), and bring
   *  back the person a cookie-restored device has not picked; a 401 sends the device back to the
   *  door. The load itself, and why a poll is silent, are `useFeldLoad`'s. */
  const loadAssignments = useCallback(async (
    personnelId: string,
    options?: { silent?: boolean; token?: string },
  ) => {
    const activeToken = options?.token ?? token
    if (!activeToken) return
    await load(personnelId, activeToken, {
      silent: options?.silent,
      // A device coming back from its cookie has no picker to have chosen from,
      // so the person is restored from the response it was going to fetch
      // anyway — one round trip, not two, and no picker for somebody who has
      // already said who they are. The /reko name cookie rides along, so a
      // bound-link or cookie-restored device still signs its Reko form.
      onAnswer: data => {
        writeFeldName(data.personnel_name)
        setSelectedPerson(prev => prev ?? {
          personnel_id: data.personnel_id,
          name: data.personnel_name,
          kennung: null,
          role: data.personnel_role,
          checked_in: data.checked_in,
          incident_count: data.assignments.length,
          open_count: data.assignments.filter(a => a.is_active_assignment).length,
          missing_rapport_count: data.assignments.filter(owesRapport).length,
        })
      },
      onSignedOut: forgetDevice,
    })
  }, [token, load, forgetDevice])

  // The one decision on mount: has this device already been through the door?
  // A stored token means yes, and it goes straight to the list — the code is
  // asked once per device, not once per visit. Keyed on the link alone: the helpers it calls
  // are read through an effect event, because re-running the door on every `loadAssignments`
  // identity change would drag a crew back out of whatever they had navigated to.
  const passDoor = useEffectEvent(() => {
    if (!linkToken) {
      setError(t('missingCode'))
      setLoading(false)
      return
    }
    // A person-bound link (the board's direct Reko link) IS the credential:
    // whoever just opened it was sent it by name, so it outranks whatever this
    // device remembered — same rule as the slip preselect outranking the
    // incident memory. Adopting it is idempotent; no server call happens here.
    const bound = decodeFeldCredential(linkToken)
    if (bound && !bound.personnelId) {
      refuse({ kind: 'expired' })
      setViewMode('code')
      setLoading(false)
      return
    }
    if (bound?.personnelId) {
      admit(linkToken, { remember: true })
      writeCookie(PERSON_COOKIE, bound.personnelId, FELD_COOKIE_SCOPE)
      setViewMode('assignments')
      loadAssignments(bound.personnelId, { token: linkToken })
      setLoading(false)
      return
    }
    const storedToken = readDeviceToken()
    const storedPerson = readCookie(PERSON_COOKIE)
    if (storedToken && storedPerson) {
      admit(storedToken)
      setViewMode('assignments')
      loadAssignments(storedPerson, { token: storedToken })
      setLoading(false)
      return
    }
    // Logged in to Rück on this phone? Then the session counts instead of the four digits
    // (server-side, /unlock without a code) and the door goes straight to the picker. Anything
    // else — no session, an expired one, no network — lands on the code screen as before,
    // without that attempt counting. `loading` stays up meanwhile, so the code screen does
    // not flash for somebody who never needed it.
    let alive = true
    apiClient
      .unlockFeldWithSession(linkToken)
      .then((data) => {
        if (!alive) return
        if (data) {
          admit(data.token)
          showPicker(data)
        } else {
          setViewMode('code')
        }
      })
      .catch((err) => {
        if (!alive) return
        refuse(err instanceof FeldUnlockError ? err.failure : null)
        setViewMode('code')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  })
  useEffect(() => passDoor(), [linkToken])

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
      admit(claim.token, { remember: true })
      writeCookie(PERSON_COOKIE, person.personnel_id, FELD_COOKIE_SCOPE)
      // Readable from /reko too, so the form keeps saying who is filing.
      writeFeldName(person.name)
      setSelectedPerson(person)
      setViewMode('assignments')
      setFeld(null)
      setSelectedIncidentId(null)
      await loadAssignments(person.personnel_id, { token: claim.token })
    } catch (err) {
      console.error('Feld claim failed:', err)
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // A refused picker may already have been consumed (e.g. its response was lost).
        // Start a fresh exchange; never offer a second identity using that credential.
        forgetDevice()
        return
      }
      // A dropped connection is not a bad code. Saying «Ungültiger Code, bitte
      // QR-Code erneut scannen» to somebody standing in a cellar sends them
      // back to a poster in the vehicle hall for nothing — and the screen it
      // said it on had no way out at all.
      setError(err instanceof NetworkError ? t('claim.offline') : t('invalidCode'))
      setErrorRecoverable(true)
    }
  }, [token, admit, setFeld, loadAssignments, forgetDevice, t])

  /**
   * Open a Schadenplatz and remember it, so a reload comes back HERE.
   *
   * **A Reko auftrag skips the detail page entirely** and goes straight into the
   * form, exactly as the old per-incident Reko link did. The KP sent this person
   * out to look at one place and report back — there is nothing else for them to
   * do here, so a page of Aktionen and a Rapport section is a page of things
   * that are not theirs. (The server agrees: half those buttons would 403.)
   *
   * Unless the window has closed (`rekoWindowClosed`): a Schadenplatz the KP
   * disponierte without waiting for the Reko opens as a plain read-only detail
   * — offering the form there would collect a briefing nobody reads.
   *
   * The form gets `return_to` = this door without a Schadenplatz: once the report is
   * sent it comes straight back to the list with a receipt toast (owner, 19.11.2026),
   * instead of a «Du kannst dieses Fenster jetzt schliessen» page. The remembered
   * detail is forgotten for the same reason – the way back is the list.
   */
  const openAssignment = useCallback(async (assignment: ApiFeldAssignment) => {
    // The newest tap wins: a slow Reko link that comes back after another row was opened (or the
    // same one tapped again) goes nowhere.
    const attempt = ++rekoAttempt.current
    setRekoOpening(null)
    if (assignment.source === 'reko' && !rekoWindowClosed(assignment) && token && selectedPerson && linkToken) {
      // The row says it is opening, and on a failure says so with a retry (crosscheck A3): the
      // tap used to do nothing visible until the link came back, and nothing at all if it did not.
      setRekoOpening({ incidentId: assignment.incident_id, failed: false })
      try {
        const { link } = await apiClient.mintFeldRekoLink(
          assignment.incident_id,
          selectedPerson.personnel_id,
          token,
        )
        if (attempt !== rekoAttempt.current) return
        clearCookie(INCIDENT_COOKIE, FELD_COOKIE_SCOPE)
        router.push(withReturnTo(link, `/feld?token=${encodeURIComponent(linkToken)}`))
      } catch (err) {
        console.error('Failed to open the reko form:', err)
        if (attempt !== rekoAttempt.current) return
        setRekoOpening({ incidentId: assignment.incident_id, failed: true })
      }
      return
    }
    setSelectedIncidentId(assignment.incident_id)
    setViewMode('detail')
    writeCookie(INCIDENT_COOKIE, assignment.incident_id, FELD_COOKIE_SCOPE)
  }, [token, selectedPerson, linkToken, router])

  /** Leaving via «Zurück» is the crew saying they are done with this one, so it
   *  is also what forgets it — otherwise the back button would be undone by the
   *  next reload. */
  const leaveAssignment = useCallback(() => {
    setViewMode('assignments')
    setSelectedIncidentId(null)
    clearCookie(INCIDENT_COOKIE, FELD_COOKIE_SCOPE)
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
      clearCookie(INCIDENT_COOKIE, FELD_COOKIE_SCOPE)
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

  useFeldRefresh(selectedPerson?.personnel_id, token, loadAssignments)

  /** The check-in's writes, folded into the list. Page-level, so a check-in still out stays
   *  busy while a Schadenplatz is open (`useFeldCheckIn`). */
  const checkIn = useFeldCheckIn({
    personnelId: selectedPerson?.personnel_id,
    token,
    onCheckedIn: useCallback(() => setFeld(prev => prev && { ...prev, checked_in: true }), [setFeld]),
    onPlannedFrom: useCallback(
      (iso: string | null) => setFeld(prev => prev && { ...prev, planned_from: iso }),
      [setFeld],
    ),
  })

  const selectedAssignment = useMemo(
    () => assignments.find(a => a.incident_id === selectedIncidentId) ?? null,
    [assignments, selectedIncidentId],
  )
  /** The detail is one history entry over the list (phone sweep 24.11.2026): the phone's back
   *  gesture returns to the list instead of leaving /feld, and the header's ← walks the same
   *  history. Open only while the detail shows – a Schadenplatz the poll took away drops back
   *  to the list, and its entry with it. */
  const backToList = useHistoryLevel(viewMode === 'detail' && selectedAssignment !== null, leaveAssignment)

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
    () =>
      assignments
        // A `magazin` row was never really a Schadenplatz of theirs — it was a
        // list of incidents standing in for a list of material, because there
        // was no other place to say "your pump is still out". There is now, so
        // the stand-in goes; anyone holding the role reads the table instead.
        .filter(a => a.source !== 'magazin' || !functions.includes('magazin'))
        .sort((a, b) => feedBucket(a) - feedBucket(b)),
    [assignments, functions],
  )

  /**
   * Does this person have work of their own on the page?
   *
   * The one question that decides where the Magazin's table goes. A Materialwart
   * is regularly ALSO on a Schadenplatz — a militia brigade sends whoever is
   * there — and for that evening the inventory is the smaller half of their
   * night, not the page.
   */
  const hasOwnWork = feed.length > 0
  /** Folded by default once they have own work; their tap wins over that. */
  const [materialOpen, setMaterialOpen] = useState<boolean | null>(null)
  const materialExpanded = materialOpen ?? !hasOwnWork

  /**
   * The Magazin's own view, rendered in one of two places (see the two call
   * sites): it leads the page for somebody whose whole job it is, and follows
   * the feed — folded — for somebody who is also out on a Schadenplatz.
   */
  const materialSection = functions.includes('magazin') ? (
    <FeldMaterialSection materials={materials} expanded={materialExpanded} onExpandedChange={setMaterialOpen} />
  ) : null

  // «＋ Neuer Schadenplatz» in the header, its sheet, and the correction sheet (`useFeldMelden`).
  const melden = useFeldMelden({
    token,
    personnelId: selectedPerson?.personnel_id,
    functions,
    assignments,
    reload: loadAssignments,
    onCorrected: corrected =>
      setFeld(prev => prev && {
        ...prev,
        reports: prev.reports?.map(item => (item.incident_id === corrected.incident_id ? corrected : item)),
      }),
  })
  /** The header's second line: «Sturm Oberwil · Sa 14.11.». */
  const eventLine = [eventName, formatEventDay(eventStartedAt, intlLocale)].filter(Boolean).join(' · ')

  /** Under the identity bar, list and detail: the last good load, once one has failed. The
   *  check-in tablet's «Letzter Stand» band, same look. The 10 s poll clears it on its own. */
  const staleBand = syncFailed && syncedAt ? (
    <p role="status" className="bg-warning/15 px-4 py-2 text-center text-warning-foreground">
      {t('sync.stale', { time: formatTime(syncedAt, intlLocale) })}
    </p>
  ) : null

  if (error) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-destructive text-xl font-semibold mb-2">{t('accessRequired')}</div>
          <div className="text-muted-foreground">{error}</div>
          {/* The way out. Without it the only exit from a claim that failed
              once was closing the tab — and the crew's own list was one tap
              away the whole time. */}
          {errorRecoverable && (
            <Button
              size="lg"
              className="mt-6 w-full"
              onClick={() => {
                setError(null)
                setErrorRecoverable(false)
              }}
            >
              {tCommon('back')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- code
  if (viewMode === 'code') return codeScreen

  // ---------------------------------------------------------------- list
  if (viewMode === 'list') {
    return (
      <FeldPersonPicker
        eventName={eventName}
        personnel={personnel}
        loading={loading}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        onSelect={handleSelectPerson}
      />
    )
  }

  // ------------------------------------------------------------- detail
  if (viewMode === 'detail' && selectedAssignment) {
    return (
      // `pb-nav-reserve`: the fixed status footer (`LinkPageFooter` in FeldActions) publishes
      // its height, so the page's last section scrolls out from under it.
      <div className="min-h-dvh bg-background pb-nav-reserve">
        {/* The header is meta only — the way back, who this phone is, the
            Ereignis and its day, «＋». Somebody four taps deep in a Rapport, on
            a phone that gets handed around a vehicle, must be able to answer
            "whose page is this" without going back for it. Everything about the
            Schadenplatz is in the main card below. */}
        <FeldIdentityBar
          name={selectedPerson?.name ?? ''}
          subtitle={eventLine}
          roleLine={roleLine || selectedPerson?.role}
          onNotMe={askNotMe}
          trailing={melden.button}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={backToList}
            aria-label={tCommon('back')}
            title={tCommon('back')}
            className="-ml-2 shrink-0"
          >
            <ArrowLeft className="size-5" />
          </Button>
        </FeldIdentityBar>
        {staleBand}

        <FeldDetail
          assignment={selectedAssignment}
          personnelId={selectedPerson?.personnel_id}
          token={token}
          messageChips={messageChips}
          driverMessageChips={driverMessageChips}
          requestMaterials={requestMaterials}
          // A sent request shows up in «Angefordert» at once, not on the next poll.
          onSent={() => selectedPerson && loadAssignments(selectedPerson.personnel_id, { silent: true })}
          onReported={applyFieldReport}
          onRapportSaved={applyRapportState}
        />

        {/* The one «Neuer Schadenplatz» sheet, opened by the header's «＋». */}
        {melden.sheet}
      </div>
    )
  }

  // -------------------------------------------------------- assignments
  return (
    <div className="min-h-dvh bg-background pb-[env(safe-area-inset-bottom)]">
      <FeldIdentityBar
        name={selectedPerson?.name ?? ''}
        subtitle={eventLine}
        roleLine={roleLine || selectedPerson?.role}
        onNotMe={askNotMe}
        trailing={melden.button}
      />
      {staleBand}

      <div className="max-w-md mx-auto space-y-3 p-4">
        {/* Not here yet: the one thing worth a full-width button, because it is
            what somebody arriving does before anything else exists for them. */}
        {/* Not after a failed first load: «nicht anwesend» would be a guess, nothing was loaded. */}
        {!checkedIn && !(syncFailed && !syncedAt) && (
          <FeldCheckIn checkIn={checkIn} planFrom={planFrom} planUntil={planUntil} />
        )}

        {/* The Magazin's inventory, when the Materialwart has nothing else on:
            then it IS their page, and it opens the screen. Somebody who is also
            out on a Schadenplatz gets it after their own work — see below. */}
        {!hasOwnWork && materialSection}

        {/* "Noch kein Einsatz" is for somebody whose page is otherwise empty.
            A Materialwart reading a full table of material has not been told
            nothing — telling them they have no job would contradict the screen
            they are looking at. */}
        {loadingAssignments ? null : syncFailed && !syncedAt ? (
          // Nothing ever came back: not «kein Auftrag», which would be a claim about the KP.
          <div role="alert" className="py-12 text-center">
            <p className="mb-2 text-base font-medium">{t('sync.failedTitle')}</p>
            <p className="mb-4 px-2 text-sm text-muted-foreground">{t('sync.failedBody')}</p>
            <Button
              variant="outline"
              onClick={() => {
                const last = lastAsked()
                if (last) loadAssignments(last.personnelId, { token: last.token })
              }}
            >
              {t('sync.retry')}
            </Button>
          </div>
        ) : feed.length === 0 && !functions.includes('magazin') ? (
          <FeldEmptyFeed functions={functions} driverVehicles={driverVehicles} checkedIn={checkedIn} />
        ) : (
          <FeldAssignmentFeed
            feed={feed}
            planned={planned}
            selfId={selectedPerson?.personnel_id}
            rekoOpening={rekoOpening}
            onOpen={openAssignment}
          />
        )}
        {/* No «Früher» row to sit above: the Danach close the live list. */}
        {!loadingAssignments && !feed.some((assignment) => !isLiveAssignment(assignment)) && (
          <FeldDanachList planned={planned} />
        )}

        <FeldReportsList reports={reports} onEdit={melden.editReport} />

        {/* The same inventory, for a Materialwart who is ALSO out on a job:
            below their own Schadenplätze and folded, because for them the table
            is reference — «wo ist die zweite Pumpe?» — and their own stops are
            what decides the next hour. Unfolded it is thirty-eight rows, which
            is how it came to hide a two-stop Auftrag under itself. */}
        {hasOwnWork && materialSection}

        {/* No «Eingecheckt» row. Checking IN is the crew's and checking out is
            not — abmelden from a phone in a vehicle edits the roll call the KP
            is keeping — so what was left was a button-less statement of
            something the page already proves: you are looking at your own
            Einsätze, which nobody who is not checked in ever sees. The
            not-checked-in case still speaks for itself, loudly, above. */}
      </div>

      {/* The «Neuer Schadenplatz» sheet, built once above — see `useFeldMelden`. */}
      {melden.sheet}

      {/* The correction sheet — the same form, prefilled (`useFeldMelden`). */}
      {melden.correctionSheet}

      {notMeDialog}
    </div>
  )
}
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
import { FeldRapportForm } from '@/components/feld/feld-rapport-form'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { topLoading } from '@/components/ui/top-loading-bar'
import { getActiveLocale } from '@/lib/i18n-messages'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'

type ViewMode = 'list' | 'assignments' | 'detail'

const COOKIE_NAME = 'feld-selected-person'
const COOKIE_EXPIRY_DAYS = 7

function getSelectedPersonFromCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(^| )${COOKIE_NAME}=([^;]+)`))
  return match ? match[2] : null
}

function saveSelectedPersonToCookie(personnelId: string) {
  const expires = new Date()
  expires.setDate(expires.getDate() + COOKIE_EXPIRY_DAYS)
  document.cookie = `${COOKIE_NAME}=${personnelId};expires=${expires.toUTCString()};path=/feld`
}

function clearSelectedPersonCookie() {
  document.cookie = `${COOKIE_NAME}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/feld`
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
  const t = useTranslations('feld')
  const tCommon = useTranslations('reko.common')
  const tStatus = useTranslations('kanban.statusLabels')
  const tPickup = useTranslations('feld.pickup')

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

  const loadAssignments = useCallback(async (personnelId: string) => {
    if (!token) return
    setLoadingAssignments(true)
    try {
      const data = await apiClient.getFeldAssignments(personnelId, token)
      setAssignments(data.assignments)
      setMessageChips(data.message_chips ?? [])
    } catch (err) {
      console.error('Failed to load field assignments:', err)
      setAssignments([])
    } finally {
      setLoadingAssignments(false)
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
    saveSelectedPersonToCookie(person.personnel_id)
    await loadAssignments(person.personnel_id)
  }, [loadAssignments])

  // Restore the person from the cookie once the picker has loaded: the crew
  // scans the poster once and lands on their own list from then on.
  useEffect(() => {
    if (restoredFromCookie.current || loading || personnel.length === 0) return
    const savedId = getSelectedPersonFromCookie()
    if (!savedId) return
    const person = personnel.find(p => p.personnel_id === savedId)
    if (person) {
      restoredFromCookie.current = true
      handleSelectPerson(person)
    }
  }, [personnel, loading, handleSelectPerson])

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

  const handleNotMe = () => {
    setSelectedPerson(null)
    setViewMode('list')
    setAssignments([])
    setSelectedIncidentId(null)
    setSearchTerm('')
    clearSelectedPersonCookie()
    restoredFromCookie.current = false
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
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
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
    const address = formatLocationForDisplay(selectedAssignment.location_address ?? '', getGlobalHomeCity())
    return (
      <div className="min-h-screen bg-background p-4 pb-20">
        <div className="max-w-md mx-auto">
          <Button variant="ghost" size="sm" onClick={() => setViewMode('assignments')} className="mb-4 -ml-2">
            <ArrowLeft className="size-3.5" />
            {tCommon('back')}
          </Button>

          {/* The detail is a STACK OF SECTIONS, not one form: plans 13 and 24
              mount here too, and the later phases of plan 25 add the actions,
              the Rapport form, the material checklist and the photos as further
              sections rather than a rewrite. */}
          <div className="space-y-4">
            {/* Section: header — what and where, plus the EL briefing */}
            <section className="rounded-xl bg-secondary/50 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h1 className="text-lg font-semibold leading-tight">{selectedAssignment.incident_title}</h1>
                <RapportStateChip state={selectedAssignment.rapport_state} />
              </div>
              {address && (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground mb-2">
                  <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{address}</span>
                </p>
              )}
              <LeaderLine assignment={selectedAssignment} selfId={selectedPerson?.personnel_id} className="mb-2" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{tStatus(selectedAssignment.incident_status)}</span>
                {selectedAssignment.arrived_at && (
                  <span>{t('detail.arrivedAt', { time: formatTime(selectedAssignment.arrived_at) })}</span>
                )}
                {selectedAssignment.field_complete_reported_at && (
                  <span>
                    {t('detail.completeAt', { time: formatTime(selectedAssignment.field_complete_reported_at) })}
                  </span>
                )}
              </div>
            </section>

            {/* Section: field actions — Angekommen / Einsatz beendet /
                Abholung / Meldung. Fotos join them in phase 3. */}
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
            {token && selectedPerson && (
              <section className="rounded-xl bg-secondary/30 p-4">
                <h2 className="text-sm font-medium mb-3">{t('detail.rapportTitle')}</h2>
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
            const address = formatLocationForDisplay(assignment.location_address ?? '', getGlobalHomeCity())
            return (
              <button
                key={assignment.incident_id}
                onClick={() => {
                  setSelectedIncidentId(assignment.incident_id)
                  setViewMode('detail')
                }}
                className={`w-full text-left rounded-xl p-4 transition-colors ${
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
                <div className="flex flex-wrap items-center gap-2">
                  <RapportStateChip state={assignment.rapport_state} />
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

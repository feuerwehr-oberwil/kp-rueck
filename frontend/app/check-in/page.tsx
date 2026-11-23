'use client'

import { SearchEmptyState } from "@/components/ui/empty-state"
import { PersonName } from "@/components/person-name"
import { LinkPageHeader } from '@/components/link-page/link-page'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiClient, type ApiPersonnelListItem } from '@/lib/api-client'
import { SearchInput } from '@/components/ui/search-input'
import { LoadingStatus } from '@/components/ui/shell-loader'
import { CheckCircle, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { undoToast } from '@/lib/toast-undo'
import { QuickAddPersonnel } from '@/components/quick-add-personnel'
import { usePolling } from '@/lib/hooks/use-polling'
import { ApiError } from '@/lib/api/types'
import { useAuth } from '@/lib/contexts/auth-context'
import { sortByName } from '@/lib/roster-order'
import { PlannedTimeChip, PlannedTimePicker } from '@/components/attendance/planned-time'
import { cn } from '@/lib/utils'

export default function CheckInPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  return <CheckInKiosk key={token} token={token} />
}

function CheckInKiosk({ token }: { token: string | null }) {
  const t = useTranslations('intake.checkin')
  const tPlan = useTranslations('common.attendancePlan')
  const { isEditor } = useAuth()

  const [personnel, setPersonnel] = useState<ApiPersonnelListItem[]>([])
  const [eventName, setEventName] = useState<string>('')
  // The Ereignis the token opens – a person added here becomes its guest.
  const [eventId, setEventId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [retrying, setRetrying] = useState(false)
  // Requests launched before a more recent refresh or local mutation must not roll it back.
  const rosterRevision = useRef(0)
  // Per-person guard against accidental double-taps: while a person's check-in
  // toggle is in flight (plus a short cooldown), further taps are ignored so a
  // fast double-press can't check in and immediately check out again.
  const togglingRef = useRef<Set<string>>(new Set())

  const loadPersonnel = useCallback(async () => {
    if (!token) return
    const revision = ++rosterRevision.current
    try {
      const data = await apiClient.getCheckInList(token)
      if (revision !== rosterRevision.current) return
      if (data) {
        setPersonnel(data.personnel)
        setEventName(data.event_name)
        setEventId(data.event_id)
        setLoading(false)
        setRetrying(false)
        return
      }
    } catch (error) {
      if (revision !== rosterRevision.current) return
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        setInvalid(true)
        return
      }
    }
    setRetrying(true)
  }, [token])

  // Kiosk links authorize attendance reads, while the operations socket requires a login.
  usePolling(loadPersonnel, { intervalMs: 5000, enabled: !!token && !invalid })
  useEffect(() => {
    if (!token || invalid) return
    window.addEventListener('online', loadPersonnel)
    return () => window.removeEventListener('online', loadPersonnel)
  }, [loadPersonnel, token, invalid])

  const toggleCheckIn = async (person: ApiPersonnelListItem) => {
    if (!token) return

    // Ignore accidental double-taps while this person's toggle is in flight
    if (togglingRef.current.has(person.id)) return

    // Prevent checkout of assigned personnel
    if (person.checked_in && person.is_assigned) {
      toast.error(t('checkoutBlocked'), {
        description: t('checkoutBlockedDescription')
      })
      return
    }

    togglingRef.current.add(person.id)
    try {
      const checkingOut = person.checked_in
      if (!(await setCheckedIn(person, !checkingOut))) return
      if (checkingOut) {
        // Check-in stays one tap; checking out is what a thumb brushing the list
        // does by accident, so it can be taken back from the toast.
        // undoToast stands on the phone too, where toast.success is muted.
        undoToast(t('checkedOut', { name: person.name }), {
          onUndo: () => setCheckedIn(person, true),
        })
      } else {
        // The next person at the door starts from the whole list, not from «Acker».
        setSearchTerm('')
      }
    } finally {
      // Small cooldown so a rapid second tap doesn't immediately re-toggle
      setTimeout(() => togglingRef.current.delete(person.id), 500)
    }
  }

  /** One check-in or check-out, applied locally once the server took it. False on failure. */
  const setCheckedIn = async (person: ApiPersonnelListItem, checkedIn: boolean): Promise<boolean> => {
    if (!token) return false
    try {
      if (checkedIn) {
        await apiClient.checkInPersonnel(person.id, token)
      } else {
        await apiClient.checkOutPersonnel(person.id, token)
      }
      rosterRevision.current++
      setPersonnel(prev => prev.map(p => (p.id === person.id ? { ...p, checked_in: checkedIn } : p)))
      return true
    } catch (error) {
      console.error('Check-in toggle failed:', error)
      toast.error(t('statusError'), {
        description: t('statusErrorDescription')
      })
      // Reload to get correct state (background refresh)
      void loadPersonnel()
      return false
    }
  }

  /** «Ich bin da bis …» through the link's own door. Rejects, so the picker says it failed. */
  const setUntil = async (person: ApiPersonnelListItem, iso: string | null) => {
    if (!token) return
    const updated = await apiClient.setAttendancePlan(person.id, { token }, { planned_until: iso })
    rosterRevision.current++
    setPersonnel(prev => prev.map(p => (p.id === person.id ? { ...p, planned_until: updated.planned_until ?? null } : p)))
  }

  // Always alphabetical, and by the SAME comparator the Anwesenheit modal and the
  // /feld picker use (`lib/roster-order.ts`) — three lists of the same roster that
  // disagree on where the second Müller sits is three lists nobody can read.
  const filteredPersonnel = sortByName(
    personnel.filter(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.role && p.role.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  )

  const stats = {
    total: personnel.length,
    checkedIn: personnel.filter(p => p.checked_in).length,
  }

  if (!token || invalid || (retrying && loading)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-destructive text-xl font-semibold mb-2">
            {retrying && !invalid && token ? t('retrying') : t('accessRequired')}
          </div>
          <div className="text-muted-foreground">{!token ? t('missingCode') : invalid ? t('invalidCode') : t('willRetry')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(env(safe-area-inset-bottom,0px)+6rem)]">
      {/* The shared link-page header (the same bar as /feld and /reko), the Ereignis as its
          context line; the counts stay with the list they count. */}
      <LinkPageHeader title={t('title')} subtitle={eventName || undefined} />
      {retrying && <p role="status" className="bg-warning/15 px-4 py-2 text-center text-warning-foreground">{t('lastKnown')}</p>}
      <div className="max-w-md mx-auto px-4 pt-4 mb-4">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{t('statsTotal', { count: stats.total })}</span>
          <span className="text-sel-foreground font-semibold">
            {t('statsPresent', { count: stats.checkedIn })}
          </span>
          <span>{t('statsAbsent', { count: stats.total - stats.checkedIn })}</span>
        </div>
      </div>

      {/* Search and Add Button */}
      <div className="max-w-md mx-auto px-4 mb-4 space-y-3">
        <SearchInput
          size="lg"
          placeholder={t('searchPlaceholder')}
          value={searchTerm}
          onValueChange={setSearchTerm}
          className="h-12 text-lg"
        />

        {/* Quick Add Personnel Component */}
        {isEditor && !loading && eventId && <QuickAddPersonnel
          submissionDisabled={retrying}
          onPersonAdded={async (newPerson) => {
            rosterRevision.current++
            // Optimistically add new person to list without full refresh
            if (newPerson) {
              setPersonnel(prev => [...prev.filter(p => p.id !== newPerson.id), {
                id: newPerson.id,
                name: newPerson.name,
                checked_in: newPerson.checked_in,
                is_assigned: false
              }])
            }
            // Clear the search so the freshly added person is visible in the
            // (always alphabetically sorted) list, not hidden by a stale filter.
            setSearchTerm('')
          }}
          checkInToken={token || undefined}
          guestEventId={eventId}
          isNameTaken={(name) =>
            personnel.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())
          }
        />}
      </div>

      {/* Personnel List */}
      <div className="max-w-md mx-auto px-4 space-y-2">
        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingStatus>{t('loading')}</LoadingStatus>
          </div>
        ) : filteredPersonnel.length === 0 && searchTerm.trim() ? (
          <SearchEmptyState query={searchTerm} onClear={() => setSearchTerm('')} />
        ) : filteredPersonnel.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('noneFound')}
          </div>
        ) : (
          filteredPersonnel.map(person => {
            const isDisabled = person.checked_in && person.is_assigned
            const stateId = `checkin-state-${person.id}`
            // One card, one toggle: the button is the name, stretched over the whole card
            // (`after:inset-0`), so a tap anywhere checks in or out. The «bis» chip is the only
            // thing above it – inside the card, right of the state pill. It used to hang under
            // the card, between two people (owner, 24.11.2026).
            return (
              <div
                key={person.id}
                data-testid="checkin-card"
                className={cn(
                  'relative flex items-center gap-4 rounded-lg border-2 p-4 transition-all',
                  isDisabled
                    ? 'border-border bg-muted/40 opacity-75'
                    : person.checked_in
                      ? 'border-sel-edge bg-sel-wash'
                      : 'border-border bg-card hover:border-muted-foreground',
                )}
              >
                {/* Check Icon */}
                <div className="flex-shrink-0">
                  {person.checked_in ? (
                    <CheckCircle className="h-8 w-8 text-sel-foreground" />
                  ) : (
                    <Circle className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>

                {/* Name, then the state pill – under the name on a phone, beside it from `sm`.
                    Beside it on a 393px row the pill kept its width and «Bendik-Dimitrijević
                    Alexandra» broke over three lines (phone sweep 14.11.2026). */}
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <button
                    type="button"
                    onClick={() => toggleCheckIn(person)}
                    disabled={isDisabled || retrying}
                    aria-describedby={stateId}
                    className="min-w-0 break-words text-left text-lg font-semibold after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring disabled:cursor-not-allowed"
                  >
                    <PersonName name={person.name} personnelId={person.id} kennung={person.kennung} />
                  </button>
                  <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                    {person.is_assigned ? (
                      <span id={stateId} className="bg-foreground/10 text-foreground px-3 py-1 rounded-full text-sm font-semibold">
                        {t('badgeAssigned')}
                      </span>
                    ) : person.checked_in ? (
                      <span id={stateId} className="bg-sel-wash text-sel-foreground px-3 py-1 rounded-full text-sm font-semibold">
                        {t('badgeCheckedIn')}
                      </span>
                    ) : (
                      <span id={stateId} className="bg-muted text-muted-foreground px-3 py-1 rounded-full text-sm">
                        {t('badgeNotCheckedIn')}
                      </span>
                    )}
                    {/* Somebody here can say until when (#3): a bottom sheet sets it – the KP's
                        pickers then show «bis 22:00». Not for anybody not in yet: at the door,
                        they are arriving now. `relative` lifts it above the stretched toggle. */}
                    {person.checked_in && (
                      <PlannedTimePicker
                        kind="until"
                        value={person.planned_until}
                        other={person.planned_from}
                        title={tPlan('titleUntil', { name: person.name })}
                        hint={tPlan('hintSelf')}
                        fieldLabel={tPlan('selfUntil')}
                        onSave={(iso) => setUntil(person, iso)}
                        trigger={<PlannedTimeChip at={person.planned_until} disabled={retrying} className="relative" />}
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

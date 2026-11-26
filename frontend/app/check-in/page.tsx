'use client'

import { SearchEmptyState } from "@/components/ui/empty-state"
import { PersonName } from "@/components/person-name"
import { LinkPageHeader } from '@/components/link-page/link-page'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiClient, type ApiPersonnelListItem } from '@/lib/api-client'
import { SearchInput } from '@/components/ui/search-input'
import { FormMessage, fieldMessageProps, formMessageId } from '@/components/ui/form-message'
import { LoadingStatus } from '@/components/ui/shell-loader'
import { Check, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { undoToast } from '@/lib/toast-undo'
import { QuickAddPersonnel } from '@/components/quick-add-personnel'
import { usePolling } from '@/lib/hooks/use-polling'
import { ApiError } from '@/lib/api/types'
import { useAuth } from '@/lib/contexts/auth-context'
import { sortByName } from '@/lib/roster-order'
import { PlannedTimeChip, PlannedTimePicker } from '@/components/attendance/planned-time'
import { cn } from '@/lib/utils'


/** The name search, which is also the guest door's name field. */
const SEARCH_ID = 'check-in-search'
export default function CheckInPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  return <CheckInKiosk key={token} token={token} />
}

function CheckInKiosk({ token }: { token: string | null }) {
  const t = useTranslations('intake.checkin')
  const tPlan = useTranslations('common.attendancePlan')
  const tEmpty = useTranslations('common.emptyState')
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
  // The guest row's own double-tap guard: state for the disabled look, a ref for the
  // second tap that lands before React re-renders.
  const [addingGuest, setAddingGuest] = useState(false)
  // A name the guest door refused (422): said under the search field, not as a toast; it goes
  // when the name is edited or the row is tapped again.
  const [guestNameError, setGuestNameError] = useState<string | null>(null)
  const addingGuestRef = useRef(false)

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

  /** «‹Name› als Gast einchecken»: one tap, then the next person starts from the whole list. */
  const checkInGuest = async (name: string) => {
    if (!token || addingGuestRef.current) return
    addingGuestRef.current = true
    setAddingGuest(true)
    setGuestNameError(null)
    try {
      const person = await apiClient.checkInGuest(token, name)
      rosterRevision.current++
      setPersonnel(prev => [...prev.filter(p => p.id !== person.id), person])
      setSearchTerm('')
      // Neutral: a name the server matches to somebody listed checks THEM in, not a guest.
      toast(t('guestCheckedIn', { name: person.name }))
    } catch (error) {
      // 409 («Bitte beim KP melden») and 429 («Zu viele Anfragen …») carry their own sentence;
      // 422 is a name the door does not take (invisible characters); anything else is the toggle's.
      if (error instanceof ApiError && (error.status === 409 || error.status === 429)) toast.error(error.message)
      else if (error instanceof ApiError && error.status === 422) setGuestNameError(t('guestNameRefused'))
      else toast.error(t('statusError'), { description: t('statusErrorDescription') })
    } finally {
      addingGuestRef.current = false
      setAddingGuest(false)
    }
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

  // The name the guest row would check in: what the server stores (`PersonName`: trimmed,
  // inner whitespace collapsed, ≤100 characters). Anything else gets the plain empty state.
  const typedName = searchTerm.trim().split(/\s+/).join(' ')
  const guestName = typedName.length > 0 && typedName.length <= 100 ? typedName : ''

  const stats = {
    total: personnel.length,
    checkedIn: personnel.filter(p => p.checked_in).length,
  }

  if (!token || invalid || (retrying && loading)) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-4">
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
    <div className="min-h-dvh bg-background pb-[calc(env(safe-area-inset-bottom,0px)+6rem)]">
      {/* The shared link-page header (the same bar as /feld and /reko), the Ereignis as its
          context line; the counts stay with the list they count. */}
      <LinkPageHeader title={t('title')} subtitle={eventName || undefined} />
      {retrying && <p role="status" className="bg-warning/15 px-4 py-2 text-center text-warning-foreground">{t('lastKnown')}</p>}
      <div className="max-w-md mx-auto px-4 pt-4 mb-4">
        {/* Each count stays on its line: «Gesamt: / 69» broke apart at 375px. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 whitespace-nowrap text-sm text-muted-foreground">
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
          id={SEARCH_ID}
          value={searchTerm}
          onValueChange={(value) => {
            setSearchTerm(value)
            setGuestNameError(null)
          }}
          className="h-12 text-lg"
          {...fieldMessageProps(SEARCH_ID, guestNameError ? 'error' : null)}
        />
        <FormMessage id={formMessageId(SEARCH_ID)}>{guestNameError}</FormMessage>

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
                is_assigned: false,
                kennung: null,
                role: null,
                status: 'available',
                tags: null,
                checked_in_at: null,
                checked_out_at: null,
                planned_from: null,
                planned_until: null,
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
      <div className="max-w-md mx-auto px-4 space-y-1.5">
        {loading ? (
          <div className="flex justify-center py-8">
            <LoadingStatus>{t('loading')}</LoadingStatus>
          </div>
        ) : filteredPersonnel.length === 0 && guestName ? (
          // Nobody of that name (7A, phone sweep 24.11.2026): the typed name checks in as a
          // guest of this Ereignis in one tap – KP Front's «‹Name› als Gast hinzufügen».
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('guestNotListed', { name: guestName })}</p>
            <button
              type="button"
              onClick={() => void checkInGuest(guestName)}
              disabled={addingGuest || retrying}
              className="flex min-h-14 w-full items-center gap-3 rounded-xl border-[1.5px] border-dashed border-sel-edge bg-card px-3.5 py-2.5 text-left font-semibold text-sel-foreground disabled:opacity-60"
            >
              <UserPlus className="h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {t('guestAdd', { name: guestName })}
                <span className="block text-sm font-normal text-muted-foreground">{t('guestAddHint')}</span>
              </span>
            </button>
            <Button variant="link" className="w-full text-muted-foreground" onClick={() => setSearchTerm('')}>
              {tEmpty('clearSearch')}
            </Button>
          </div>
        ) : filteredPersonnel.length === 0 && searchTerm.trim() ? (
          <SearchEmptyState query={searchTerm} onClear={() => setSearchTerm('')} />
        ) : filteredPersonnel.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('noneFound')}
          </div>
        ) : (
          filteredPersonnel.map(person => {
            // 8A (phone sweep 24.11.2026): one line per person, the glyph carries the state –
            // ○ nicht anwesend, blue ✓ anwesend, grey ✓ + «Im Einsatz» for somebody who cannot
            // check out here. The word is the row's accessible description, said once.
            const isDisabled = person.checked_in && !!person.is_assigned
            const stateId = `checkin-state-${person.id}`
            const state = person.is_assigned ? t('badgeAssigned') : person.checked_in ? t('badgeCheckedIn') : t('badgeNotCheckedIn')
            // One row, one toggle: the button is the name, stretched over the whole row
            // (`after:inset-0`), so a tap anywhere checks in or out. The «bis» chip is the only
            // thing above it, on the same line (owner, 24.11.2026). A long name wraps to a
            // second line beside the chips; nothing is cut.
            return (
              <div
                key={person.id}
                data-testid="checkin-card"
                className={cn(
                  'relative flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-1',
                  isDisabled
                    ? 'border-border bg-muted opacity-85'
                    : person.checked_in
                      ? 'border-sel-edge bg-sel-wash'
                      : 'border-border bg-card',
                )}
              >
                <StateGlyph present={person.checked_in} locked={isDisabled} />
                <button
                  type="button"
                  onClick={() => toggleCheckIn(person)}
                  disabled={isDisabled || retrying}
                  aria-describedby={stateId}
                  className="min-w-0 flex-1 break-words text-left font-semibold leading-tight after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring disabled:cursor-not-allowed"
                >
                  <PersonName name={person.name} personnelId={person.id} kennung={person.kennung} />
                </button>
                {person.is_assigned ? (
                  <span id={stateId} className="shrink-0 whitespace-nowrap rounded-full bg-foreground/10 px-2.5 py-0.5 text-sm font-semibold text-foreground">
                    {state}
                  </span>
                ) : (
                  <span id={stateId} className="sr-only">{state}</span>
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
                    trigger={<PlannedTimeChip at={person.planned_until} disabled={retrying} className="relative shrink-0" />}
                  />
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** The row's state as a glyph: ○ nicht anwesend, ✓ on the blue wash anwesend, grey ✓ when
 *  the person is present but cannot check out here (assigned). Decorative – the row says the
 *  word through `aria-describedby`. */
function StateGlyph({ present, locked }: { present: boolean; locked: boolean }) {
  if (!present) return <span aria-hidden className="h-[26px] w-[26px] shrink-0 rounded-full border-2 border-muted-foreground" />
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full',
        locked ? 'bg-foreground/10 text-muted-foreground' : 'bg-sel-wash text-sel-foreground ring-1 ring-sel-edge',
      )}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </span>
  )
}

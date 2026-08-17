'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { apiClient, type ApiPersonnelListItem } from '@/lib/api-client'
import { SearchInput } from '@/components/ui/search-input'
import { CheckCircle, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { QuickAddPersonnel } from '@/components/quick-add-personnel'
import { wsClient } from '@/lib/websocket-client'
import { RESOURCE_STATE_DOT_CLASSES } from '@/lib/resource-status'
import { sortByName } from '@/lib/roster-order'
import { cn } from '@/lib/utils'

export default function CheckInPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const t = useTranslations('intake.checkin')

  const [personnel, setPersonnel] = useState<ApiPersonnelListItem[]>([])
  const [eventName, setEventName] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Track if we just made a local change to skip the next WebSocket refresh (use ref to avoid stale closures)
  const skipNextRefreshRef = useRef(false)
  // Per-person guard against accidental double-taps: while a person's check-in
  // toggle is in flight (plus a short cooldown), further taps are ignored so a
  // fast double-press can't check in and immediately check out again.
  const togglingRef = useRef<Set<string>>(new Set())

  // Load personnel list - isInitialLoad=true shows loading spinner, false for background refresh
  const loadPersonnel = useCallback(async (isInitialLoad = false) => {
    if (!token) return

    if (isInitialLoad) {
      setLoading(true)
    }
    setError(null)
    try {
      const data = await apiClient.getCheckInList(token)
      setPersonnel(data.personnel)
      setEventName(data.event_name)
    } catch (error) {
      console.error('Failed to load personnel:', error)
      if (isInitialLoad) {
        setError(t('invalidCode'))
      }
    } finally {
      if (isInitialLoad) {
        setLoading(false)
      }
    }
  }, [token, t])

  useEffect(() => {
    if (!token) {
      setError(t('missingCode'))
      setLoading(false)
      return
    }

    // Load initial data with loading spinner
    loadPersonnel(true)

    // Connect to WebSocket for real-time updates
    wsClient.connect()

    // Listen for personnel updates
    const unsubscribePersonnel = wsClient.on('personnel_update', () => {
      // Skip refresh if we just made a local change (prevents scroll reset)
      if (skipNextRefreshRef.current) {
        skipNextRefreshRef.current = false
        return
      }
      // Refresh the personnel list in background (no loading spinner) when someone is added, checked in, or checked out
      loadPersonnel(false)
    })

    // Cleanup on unmount
    return () => {
      unsubscribePersonnel()
      wsClient.disconnect()
    }
  }, [token, loadPersonnel, t])

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
    // Skip the next WebSocket refresh since we do an optimistic update
    skipNextRefreshRef.current = true

    try {
      if (person.checked_in) {
        await apiClient.checkOutPersonnel(person.id, token)
      } else {
        await apiClient.checkInPersonnel(person.id, token)
      }
      // Optimistic update
      setPersonnel(prev =>
        prev.map(p =>
          p.id === person.id ? { ...p, checked_in: !p.checked_in } : p
        )
      )
    } catch (error) {
      console.error('Check-in toggle failed:', error)
      toast.error(t('statusError'), {
        description: t('statusErrorDescription')
      })
      skipNextRefreshRef.current = false // Allow refresh on error to get correct state
      // Reload to get correct state (background refresh)
      loadPersonnel(false)
    } finally {
      // Small cooldown so a rapid second tap doesn't immediately re-toggle
      setTimeout(() => togglingRef.current.delete(person.id), 500)
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

  const stats = {
    total: personnel.length,
    checkedIn: personnel.filter(p => p.checked_in).length,
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-destructive text-xl font-semibold mb-2">
            {t('accessRequired')}
          </div>
          <div className="text-muted-foreground">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background px-4 pt-6 pb-24">
      {/* Header */}
      <div className="max-w-2xl mx-auto mb-6">
        <h1 className="text-2xl font-bold mb-2">
          {t('title')}
        </h1>
        {eventName && (
          <p className="text-lg text-muted-foreground mb-3">
            {t('eventLabel')} <span className="font-semibold text-foreground">{eventName}</span>
          </p>
        )}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{t('statsTotal', { count: stats.total })}</span>
          <span className="text-blue-500 font-semibold">
            {t('statsPresent', { count: stats.checkedIn })}
          </span>
          <span>{t('statsAbsent', { count: stats.total - stats.checkedIn })}</span>
        </div>
      </div>

      {/* Search and Add Button */}
      <div className="max-w-2xl mx-auto mb-4 space-y-3">
        <SearchInput
          size="lg"
          placeholder={t('searchPlaceholder')}
          value={searchTerm}
          onValueChange={setSearchTerm}
          className="h-12 text-lg"
        />

        {/* Quick Add Personnel Component */}
        <QuickAddPersonnel
          onPersonAdded={async (newPerson) => {
            // Skip the next WebSocket refresh to prevent scroll reset
            skipNextRefreshRef.current = true
            // Optimistically add new person to list without full refresh
            if (newPerson) {
              setPersonnel(prev => [...prev, {
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
          isNameTaken={(name) =>
            personnel.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())
          }
        />
      </div>

      {/* Personnel List */}
      <div className="max-w-2xl mx-auto space-y-2">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">{t('loading')}</div>
        ) : filteredPersonnel.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('noneFound')}
          </div>
        ) : (
          filteredPersonnel.map(person => {
            const isDisabled = person.checked_in && person.is_assigned
            return (
            <button
              key={person.id}
              onClick={() => toggleCheckIn(person)}
              disabled={isDisabled}
              className={`
                w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all
                ${
                  isDisabled
                    ? 'border-amber-500 bg-amber-500/10 cursor-not-allowed opacity-75'
                    : person.checked_in
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-border bg-card hover:border-muted-foreground'
                }
              `}
            >
              {/* Check Icon */}
              <div className="flex-shrink-0">
                {person.checked_in ? (
                  <CheckCircle className="h-8 w-8 text-blue-500" />
                ) : (
                  <Circle className="h-8 w-8 text-muted-foreground" />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 text-left">
                <div className="font-semibold text-lg">{person.name}</div>
              </div>

              {/* Status Badge */}
              <div className="flex-shrink-0">
                {person.is_assigned ? (
                  <span className={cn(RESOURCE_STATE_DOT_CLASSES.assigned, "text-white px-3 py-1 rounded-full text-sm font-semibold")}>
                    {t('badgeAssigned')}
                  </span>
                ) : person.checked_in ? (
                  <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                    {t('badgeCheckedIn')}
                  </span>
                ) : (
                  <span className="bg-muted text-muted-foreground px-3 py-1 rounded-full text-sm">
                    {t('badgeNotCheckedIn')}
                  </span>
                )}
              </div>
            </button>
          )})
        )}
      </div>
    </div>
  )
}

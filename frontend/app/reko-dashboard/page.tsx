'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiClient, type ApiRekoDashboardPersonnel, type ApiRekoDashboardAssignment } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { User, Clock, FileText, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react'
import { wsClient } from '@/lib/websocket-client'

type ViewMode = 'list' | 'assignments'

const COOKIE_NAME = 'reko-selected-person'
const COOKIE_EXPIRY_DAYS = 7

function getSelectedPersonFromCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(^| )${COOKIE_NAME}=([^;]+)`))
  return match ? match[2] : null
}

function saveSelectedPersonToCookie(personnelId: string) {
  const expires = new Date()
  expires.setDate(expires.getDate() + COOKIE_EXPIRY_DAYS)
  document.cookie = `${COOKIE_NAME}=${personnelId};expires=${expires.toUTCString()};path=/reko-dashboard`
}

function clearSelectedPersonCookie() {
  document.cookie = `${COOKIE_NAME}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/reko-dashboard`
}

export default function RekoDashboardPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [personnel, setPersonnel] = useState<ApiRekoDashboardPersonnel[]>([])
  const [selectedPerson, setSelectedPerson] = useState<ApiRekoDashboardPersonnel | null>(null)
  const [assignments, setAssignments] = useState<ApiRekoDashboardAssignment[]>([])
  const [eventName, setEventName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadingAssignments, setLoadingAssignments] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const restoredFromCookie = useRef(false)

  // Sort personnel alphabetically by name for stable ordering (no reordering when status changes)
  const sortedPersonnel = useMemo(() => {
    return [...personnel].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }, [personnel])

  const loadPersonnel = useCallback(async () => {
    if (!token) return

    setLoading(true)
    setError(null)
    try {
      const data = await apiClient.getRekoDashboardPersonnel(token)
      setPersonnel(data.personnel)
      setEventName(data.event_name)
    } catch (error) {
      console.error('Failed to load Reko personnel:', error)
      setError('Ungültiger oder abgelaufener Code. Bitte Link erneut anfordern.')
    } finally {
      setLoading(false)
    }
  }, [token])

  const loadAssignments = useCallback(async (personnelId: string) => {
    if (!token) return

    setLoadingAssignments(true)
    try {
      const data = await apiClient.getRekoDashboardAssignments(personnelId, token)
      setAssignments(data.assignments)
    } catch (error) {
      console.error('Failed to load assignments:', error)
      setAssignments([])
    } finally {
      setLoadingAssignments(false)
    }
  }, [token])

  // Initial load
  useEffect(() => {
    if (!token) {
      setError('Zugriffscode fehlt. Bitte Link vom Editor anfordern.')
      setLoading(false)
      return
    }

    loadPersonnel()
  }, [token, loadPersonnel])

  // Restore selected person from cookie after personnel loads
  useEffect(() => {
    if (restoredFromCookie.current || loading || personnel.length === 0) return

    const savedPersonnelId = getSelectedPersonFromCookie()
    if (savedPersonnelId) {
      const person = personnel.find(p => p.personnel_id === savedPersonnelId)
      if (person) {
        restoredFromCookie.current = true
        handleSelectPerson(person)
      }
    }
  }, [personnel, loading])

  // Refresh assignments when page gains focus (e.g., after returning from reko form)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && selectedPerson && token) {
        loadAssignments(selectedPerson.personnel_id)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [selectedPerson, token, loadAssignments])

  // WebSocket subscription (separate effect to avoid re-subscribing)
  useEffect(() => {
    if (!token) return

    // Connect to WebSocket for real-time updates
    wsClient.connect()

    // Listen for assignment updates
    const unsubscribeAssignment = wsClient.on('assignment_update', () => {
      // Refresh data when assignments change
      loadPersonnel()
    })

    // Cleanup on unmount
    return () => {
      unsubscribeAssignment()
      wsClient.disconnect()
    }
  }, [token, loadPersonnel])

  const handleSelectPerson = async (person: ApiRekoDashboardPersonnel) => {
    setSelectedPerson(person)
    setViewMode('assignments')
    setAssignments([])
    saveSelectedPersonToCookie(person.personnel_id)
    await loadAssignments(person.personnel_id)
  }

  const handleBackToList = () => {
    setSelectedPerson(null)
    setViewMode('list')
    setAssignments([])
    clearSelectedPersonCookie()
    restoredFromCookie.current = false
    loadPersonnel()
  }

  const handleOpenRekoForm = (assignment: ApiRekoDashboardAssignment) => {
    // Generate reko link and navigate to it
    // The form will be pre-populated with the personnel_id
    if (selectedPerson && token) {
      // We need to get a fresh reko link for this incident
      apiClient.generateRekoLink(assignment.incident_id, selectedPerson.personnel_id)
        .then(({ link }) => {
          // Add return URL so user can navigate back to dashboard after submission
          const returnUrl = encodeURIComponent(`/reko-dashboard?token=${token}`)
          const linkWithReturn = link.includes('?')
            ? `${link}&return_to=${returnUrl}`
            : `${link}?return_to=${returnUrl}`
          window.location.href = linkWithReturn
        })
        .catch((error) => {
          console.error('Failed to generate Reko link:', error)
          alert('Fehler beim Öffnen des Reko-Formulars. Bitte versuchen Sie es erneut.')
        })
    }
  }


  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <div className="text-destructive text-xl font-semibold mb-2">
            Zugriff erforderlich
          </div>
          <div className="text-muted-foreground">{error}</div>
        </div>
      </div>
    )
  }

  // Personnel List View
  if (viewMode === 'list') {
    return (
      <div className="min-h-screen bg-background p-4 pb-20">
        {/* Header */}
        <div className="max-w-md mx-auto mb-8">
          <h1 className="text-2xl font-semibold text-center mb-1">Reko</h1>
          {eventName && (
            <p className="text-sm text-muted-foreground text-center">
              {eventName}
            </p>
          )}
        </div>

        {/* Personnel List */}
        <div className="max-w-md mx-auto space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sortedPersonnel.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Keine Reko-Personen verfügbar
            </div>
          ) : (
            sortedPersonnel.map(person => (
              <button
                key={person.personnel_id}
                onClick={() => handleSelectPerson(person)}
                className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
              >
                {/* User Icon */}
                <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${
                  person.assignment_count > 0 ? 'bg-orange-500/20' : 'bg-muted'
                }`}>
                  <User className={`h-5 w-5 ${person.assignment_count > 0 ? 'text-orange-600' : 'text-muted-foreground'}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{person.name}</div>
                  {person.role && (
                    <div className="text-sm text-muted-foreground truncate">{person.role}</div>
                  )}
                </div>

                {/* Status */}
                <div className="flex-shrink-0">
                  {person.assignment_count > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-600">
                      <span className="h-2 w-2 rounded-full bg-orange-500" />
                      {person.assignment_count}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Wartend
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  // Assignments View
  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      {/* Header */}
      <div className="max-w-md mx-auto mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBackToList}
          className="mb-4 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Zurück
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{selectedPerson?.name}</h1>
            {selectedPerson?.role && (
              <p className="text-sm text-muted-foreground">{selectedPerson.role}</p>
            )}
          </div>
        </div>
      </div>

      {/* Assignments */}
      <div className="max-w-md mx-auto space-y-3">
        {loadingAssignments ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium mb-1">Warte auf Zuweisung</p>
            <p className="text-sm text-muted-foreground">
              Neue Einsätze erscheinen hier automatisch
            </p>
          </div>
        ) : (
          assignments.map(assignment => (
            <div
              key={assignment.assignment_id}
              className={`rounded-xl p-4 ${
                assignment.has_completed_reko
                  ? 'bg-green-500/10'
                  : 'bg-secondary/50'
              }`}
            >
              {/* Title & Location */}
              <div className="mb-3">
                <h3 className="font-medium">{assignment.incident_title}</h3>
                {assignment.location_address && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {assignment.location_address}
                  </p>
                )}
                {assignment.has_completed_reko && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium mt-2">
                    <CheckCircle className="h-3 w-3" />
                    Abgeschlossen
                  </span>
                )}
              </div>

              {/* Action Button - show for both active and completed assignments */}
              <Button
                onClick={() => handleOpenRekoForm(assignment)}
                variant={assignment.has_completed_reko ? "outline" : "default"}
                className="w-full"
                size="lg"
              >
                <FileText className="h-4 w-4 mr-2" />
                {assignment.has_completed_reko ? 'Ergänzung hinzufügen' : 'Formular öffnen'}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

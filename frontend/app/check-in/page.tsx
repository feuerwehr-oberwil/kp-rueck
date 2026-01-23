'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiClient, type ApiPersonnelListItem } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { CheckCircle, Circle, Search } from 'lucide-react'
import { QuickAddPersonnel } from '@/components/quick-add-personnel'
import { wsClient, type WebSocketUpdate } from '@/lib/websocket-client'

export default function CheckInPage() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [personnel, setPersonnel] = useState<ApiPersonnelListItem[]>([])
  const [eventName, setEventName] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadPersonnel = useCallback(async () => {
    if (!token) return

    setLoading(true)
    setError(null)
    try {
      const data = await apiClient.getCheckInList(token)
      setPersonnel(data.personnel)
      setEventName(data.event_name)
    } catch (error) {
      console.error('Failed to load personnel:', error)
      setError('Ungültiger oder abgelaufener Code. Bitte QR-Code erneut scannen.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) {
      setError('Zugriffscode fehlt. Bitte QR-Code scannen.')
      setLoading(false)
      return
    }

    // Load initial data
    loadPersonnel()

    // Connect to WebSocket for real-time updates
    wsClient.connect()

    // Listen for personnel updates
    const unsubscribePersonnel = wsClient.on('personnel_update', (update: WebSocketUpdate) => {
      // Refresh the personnel list when someone is added, checked in, or checked out
      loadPersonnel()
    })

    // Cleanup on unmount
    return () => {
      unsubscribePersonnel()
      wsClient.disconnect()
    }
  }, [token, loadPersonnel])

  const toggleCheckIn = async (person: ApiPersonnelListItem) => {
    if (!token) return

    // Prevent checkout of assigned personnel
    if (person.checked_in && person.is_assigned) {
      alert('Diese Person ist einem Einsatz zugewiesen und kann nicht abgemeldet werden.')
      return
    }

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
      alert('Fehler beim Ändern des Check-in Status. Bitte versuchen Sie es erneut.')
      // Reload to get correct state
      loadPersonnel()
    }
  }

  const filteredPersonnel = personnel
    .filter(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.role && p.role.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => {
      // Always sort alphabetically by last name (first word in the name, format is "LAST FIRST")
      const lastNameA = a.name.split(' ')[0].toLowerCase()
      const lastNameB = b.name.split(' ')[0].toLowerCase()
      return lastNameA.localeCompare(lastNameB)
    })

  const stats = {
    total: personnel.length,
    checkedIn: personnel.filter(p => p.checked_in).length,
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

  return (
    <div className="min-h-screen bg-background p-4 pb-20">
      {/* Header */}
      <div className="max-w-2xl mx-auto mb-6">
        <h1 className="text-3xl font-bold mb-2">
          Personal Check-In
        </h1>
        {eventName && (
          <p className="text-lg text-muted-foreground mb-3">
            Ereignis: <span className="font-semibold text-foreground">{eventName}</span>
          </p>
        )}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>Gesamt: {stats.total}</span>
          <span className="text-blue-500 font-semibold">
            Anwesend: {stats.checkedIn}
          </span>
          <span>Nicht anwesend: {stats.total - stats.checkedIn}</span>
        </div>
      </div>

      {/* Search and Add Button */}
      <div className="max-w-2xl mx-auto mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Personal suchen..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-12 text-lg"
          />
        </div>

        {/* Quick Add Personnel Component */}
        <QuickAddPersonnel onPersonAdded={loadPersonnel} checkInToken={token || undefined} />
      </div>

      {/* Personnel List */}
      <div className="max-w-2xl mx-auto space-y-2">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Lädt...</div>
        ) : filteredPersonnel.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Keine Personen gefunden
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
                    ? 'border-orange-500 bg-orange-500/10 cursor-not-allowed opacity-75'
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
                  <span className="bg-orange-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                    Im Einsatz
                  </span>
                ) : person.checked_in ? (
                  <span className="bg-blue-500 text-white px-3 py-1 rounded-full text-sm font-semibold">
                    Anwesend
                  </span>
                ) : (
                  <span className="bg-muted text-muted-foreground px-3 py-1 rounded-full text-sm">
                    Nicht hier
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

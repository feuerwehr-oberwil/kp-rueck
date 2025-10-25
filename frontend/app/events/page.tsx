'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useEvent } from '@/lib/contexts/event-context'
import type { Event } from '@/lib/types/incidents'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Plus, Archive, AlertCircle, Search, Calendar, CheckCircle2 } from 'lucide-react'
import { PageNavigation } from '@/components/page-navigation'
import { ProtectedRoute } from '@/components/protected-route'

export default function EventsPage() {
  const router = useRouter()
  const { events, selectedEvent, setSelectedEvent, createEvent, archiveEvent, deleteEvent } = useEvent()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [targetEvent, setTargetEvent] = useState<Event | null>(null)

  const [newEventName, setNewEventName] = useState('')
  const [newEventTraining, setNewEventTraining] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Filter events based on search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events
    const query = searchQuery.toLowerCase()
    return events.filter(event =>
      event.name.toLowerCase().includes(query)
    )
  }, [events, searchQuery])

  const handleCreateEvent = async () => {
    if (!newEventName.trim()) return

    setIsCreating(true)
    try {
      const event = await createEvent(newEventName, newEventTraining)
      setShowCreateDialog(false)
      setNewEventName('')
      setNewEventTraining(false)

      // Automatically select and navigate to new event
      setSelectedEvent(event)
      router.push('/')
    } catch (error) {
      console.error('Failed to create event:', error)
    } finally {
      setIsCreating(false)
    }
  }

  const handleSelectEvent = (event: Event) => {
    setSelectedEvent(event)
    router.push('/')
  }

  const handleArchive = async () => {
    if (!targetEvent) return
    try {
      await archiveEvent(targetEvent.id)
      setShowArchiveDialog(false)
      setTargetEvent(null)
    } catch (error) {
      console.error('Failed to archive event:', error)
    }
  }

  const handleDelete = async () => {
    if (!targetEvent) return
    try {
      await deleteEvent(targetEvent.id)
      setShowDeleteDialog(false)
      setTargetEvent(null)
    } catch (error) {
      console.error('Failed to delete event:', error)
    }
  }

  return (
    <ProtectedRoute>
      <div className="flex flex-col h-screen">
        <PageNavigation currentPage="settings" />

        <div className="flex-1 overflow-auto p-6">
          <div className="container mx-auto">
            {/* Header with title and active event */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-4">
                <h1 className="text-3xl font-bold">Ereignisse</h1>
                {selectedEvent && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="text-lg font-medium">{selectedEvent.name}</span>
                    <Badge variant={selectedEvent.training_flag ? 'secondary' : 'destructive'}>
                      {selectedEvent.training_flag ? 'Übung' : 'Live'}
                    </Badge>
                  </div>
                )}
              </div>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Neues Ereignis
              </Button>
            </div>

            {/* Search bar */}
            <div className="mb-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ereignisse durchsuchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Events grid */}
            {filteredEvents.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  {events.length === 0
                    ? 'Keine Ereignisse vorhanden. Erstellen Sie ein neues Ereignis, um zu beginnen.'
                    : 'Keine Ereignisse gefunden.'}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredEvents.map((event) => (
                  <Card
                    key={event.id}
                    className={`cursor-pointer transition-all hover:shadow-lg ${
                      selectedEvent?.id === event.id ? 'ring-2 ring-primary' : ''
                    }`}
                  >
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-lg">{event.name}</CardTitle>
                        <Badge variant={event.training_flag ? 'secondary' : 'destructive'}>
                          {event.training_flag ? 'Übung' : 'Live'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div>Einsätze: {event.incident_count}</div>
                        <div>Erstellt: {new Date(event.created_at).toLocaleDateString('de-CH')}</div>
                        <div>Letzte Aktivität: {new Date(event.last_activity_at).toLocaleString('de-CH')}</div>
                      </div>

                      <div className="flex gap-2 mt-4">
                        <Button
                          className="flex-1"
                          onClick={() => handleSelectEvent(event)}
                        >
                          Auswählen
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setTargetEvent(event)
                            setShowArchiveDialog(true)
                          }}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Create Event Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neues Ereignis erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="event-name">Name</Label>
              <Input
                id="event-name"
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                placeholder="z.B. Sturm 2024-10-25"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="training-mode"
                checked={newEventTraining}
                onCheckedChange={setNewEventTraining}
              />
              <Label htmlFor="training-mode">Übungsmodus</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateEvent} disabled={isCreating || !newEventName.trim()}>
              Erstellen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ereignis archivieren?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p>Möchten Sie das Ereignis "{targetEvent?.name}" archivieren?</p>
            <p className="text-sm text-muted-foreground">
              Das Ereignis wird ausgeblendet, aber alle Daten bleiben erhalten.
              Sie können es später dauerhaft löschen.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveDialog(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={handleArchive}>
              Archivieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </ProtectedRoute>
  )
}

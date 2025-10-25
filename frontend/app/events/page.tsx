'use client'

import { useState } from 'react'
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
import { Plus, Archive, AlertCircle } from 'lucide-react'

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
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Ereignisse (Events)</h1>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Neues Ereignis
        </Button>
      </div>

      {events.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            Keine Ereignisse vorhanden. Erstellen Sie ein neues Ereignis, um zu beginnen.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {events.map((event) => (
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
  )
}

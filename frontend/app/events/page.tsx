'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
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
import { Plus, Archive, ArchiveRestore, AlertCircle, Search, Calendar, CheckCircle2, Trash2 } from 'lucide-react'
import { PageNavigation } from '@/components/page-navigation'
import { ProtectedRoute } from '@/components/protected-route'
import { EventExportButton } from '@/components/event-export-button'

export default function EventsPage() {
  const router = useRouter()
  const { events, selectedEvent, setSelectedEvent, createEvent, archiveEvent, unarchiveEvent, deleteEvent } = useEvent()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [targetEvent, setTargetEvent] = useState<Event | null>(null)

  const [newEventName, setNewEventName] = useState('')
  const [newEventTraining, setNewEventTraining] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Separate active and archived events
  const { activeEvents, archivedEvents } = useMemo(() => {
    const active = events.filter(e => !e.archived_at)
    const archived = events.filter(e => e.archived_at)
    return { activeEvents: active, archivedEvents: archived }
  }, [events])

  // Filter events based on search query
  const filteredActiveEvents = useMemo(() => {
    if (!searchQuery.trim()) return activeEvents
    const query = searchQuery.toLowerCase()
    return activeEvents.filter(event =>
      event.name.toLowerCase().includes(query)
    )
  }, [activeEvents, searchQuery])

  const filteredArchivedEvents = useMemo(() => {
    if (!searchQuery.trim()) return archivedEvents
    const query = searchQuery.toLowerCase()
    return archivedEvents.filter(event =>
      event.name.toLowerCase().includes(query)
    )
  }, [archivedEvents, searchQuery])

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

  const handleUnarchive = async (event: Event) => {
    try {
      await unarchiveEvent(event.id)
    } catch (error) {
      console.error('Failed to unarchive event:', error)
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Esc to blur input or cancel g-prefix mode
      if (e.key === 'Escape') {
        if (gPrefixActive) {
          setGPrefixActive(false)
          if (gPrefixTimeoutRef.current) {
            clearTimeout(gPrefixTimeoutRef.current)
            gPrefixTimeoutRef.current = null
          }
          return
        }
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          (e.target as HTMLElement).blur()
          return
        }
      }

      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Handle g-prefix navigation
      if (gPrefixActive) {
        e.preventDefault()
        setGPrefixActive(false)
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
          gPrefixTimeoutRef.current = null
        }

        if (e.key === 'k' || e.key === 'K') {
          router.push('/')
          return
        } else if (e.key === 'm' || e.key === 'M') {
          router.push('/map')
          return
        } else if (e.key === 'e' || e.key === 'E') {
          // Already on Events, do nothing
          return
        }
        return
      }

      // Activate g-prefix mode
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        setGPrefixActive(true)
        // Reset g-prefix mode after 1.5 seconds
        if (gPrefixTimeoutRef.current) {
          clearTimeout(gPrefixTimeoutRef.current)
        }
        gPrefixTimeoutRef.current = setTimeout(() => {
          setGPrefixActive(false)
          gPrefixTimeoutRef.current = null
        }, 1500)
        return
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
      // Clean up timeout on unmount
      if (gPrefixTimeoutRef.current) {
        clearTimeout(gPrefixTimeoutRef.current)
      }
    }
  }, [gPrefixActive, router])

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600 to-red-600 text-2xl shadow-lg">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Ereignisse</h1>
                {selectedEvent && (
                  <p className="text-sm text-muted-foreground">
                    Aktiv: {selectedEvent.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Neues Ereignis
            </Button>
            <PageNavigation currentPage="events" hasSelectedEvent={!!selectedEvent} />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="container mx-auto">

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

            {/* Active Events */}
            {filteredActiveEvents.length === 0 && filteredArchivedEvents.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  {events.length === 0
                    ? 'Keine Ereignisse vorhanden. Erstellen Sie ein neues Ereignis, um zu beginnen.'
                    : 'Keine Ereignisse gefunden.'}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-8">
                {/* Active Events Section */}
                {filteredActiveEvents.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold mb-4">Aktive Ereignisse</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredActiveEvents.map((event) => (
                        <Card
                          key={event.id}
                          className={`cursor-pointer transition-all hover:shadow-lg ${
                            selectedEvent?.id === event.id ? 'border-2 border-red-600' : ''
                          }`}
                        >
                          <CardHeader>
                            <CardTitle className="text-lg">{event.name}</CardTitle>
                            {event.training_flag && (
                              <p className="text-xs text-muted-foreground mt-1">Übungsmodus</p>
                            )}
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2 text-sm text-muted-foreground">
                              <div>Einsätze: {event.incident_count}</div>
                              <div>Erstellt: {new Date(event.created_at).toLocaleDateString('de-CH')}</div>
                              <div>Letzte Aktivität: {new Date(event.last_activity_at).toLocaleString('de-CH')}</div>
                            </div>

                            <div className="mt-4">
                              <div className="flex gap-2">
                                <Button
                                  className="flex-1"
                                  onClick={() => handleSelectEvent(event)}
                                >
                                  Auswählen
                                </Button>
                                <EventExportButton eventId={event.id} eventName={event.name} />
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
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Archived Events Section */}
                {filteredArchivedEvents.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold mb-4 text-muted-foreground">Archivierte Ereignisse</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredArchivedEvents.map((event) => (
                        <Card
                          key={event.id}
                          className="opacity-50 border-dashed"
                        >
                          <CardHeader>
                            <CardTitle className="text-lg text-muted-foreground">{event.name}</CardTitle>
                            {event.training_flag && (
                              <p className="text-xs text-muted-foreground mt-1">Übungsmodus</p>
                            )}
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2 text-sm text-muted-foreground">
                              <div>Einsätze: {event.incident_count}</div>
                              <div>Erstellt: {new Date(event.created_at).toLocaleDateString('de-CH')}</div>
                              <div>Archiviert: {new Date(event.archived_at!).toLocaleDateString('de-CH')}</div>
                            </div>

                            <div className="mt-4">
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  className="flex-1"
                                  onClick={() => handleUnarchive(event)}
                                >
                                  <ArchiveRestore className="mr-2 h-4 w-4" />
                                  Wiederherstellen
                                </Button>
                                <EventExportButton eventId={event.id} eventName={event.name} />
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  onClick={() => {
                                    setTargetEvent(event)
                                    setShowDeleteDialog(true)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

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

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ereignis dauerhaft löschen?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="font-semibold text-destructive">
              Warnung: Dieser Vorgang kann nicht rückgängig gemacht werden!
            </p>
            <p>Möchten Sie das Ereignis "{targetEvent?.name}" und alle zugehörigen Einsätze wirklich dauerhaft löschen?</p>
            <p className="text-sm text-muted-foreground">
              Dies betrifft {targetEvent?.incident_count || 0} Einsätze und alle zugehörigen Daten.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Dauerhaft löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </ProtectedRoute>
  )
}

'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { Plus, Archive, ArchiveRestore, AlertCircle, Search, Calendar, CheckCircle2, Trash2, GraduationCap } from 'lucide-react'
import { PageNavigation } from '@/components/page-navigation'
import { ProtectedRoute } from '@/components/protected-route'
import { EventExportButton } from '@/components/event-export-button'
import { MobileNavigation } from '@/components/mobile-navigation'
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { useIsMobile } from '@/components/ui/use-mobile'

export default function EventsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { events, selectedEvent, setSelectedEvent, createEvent, archiveEvent, unarchiveEvent, deleteEvent } = useEvent()
  const isMobile = useIsMobile()

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [targetEvent, setTargetEvent] = useState<Event | null>(null)

  const [newEventName, setNewEventName] = useState('')
  const [newEventTraining, setNewEventTraining] = useState(false)
  const [newEventAutoAttachDivera, setNewEventAutoAttachDivera] = useState(true)
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
      const event = await createEvent(newEventName, newEventTraining, newEventAutoAttachDivera)
      setShowCreateDialog(false)
      setNewEventName('')
      setNewEventTraining(false)
      setNewEventAutoAttachDivera(true)

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

  const handleCreateDialogChange = (open: boolean) => {
    setShowCreateDialog(open)
    // Reset form state when dialog is closed
    if (!open) {
      setNewEventName('')
      setNewEventTraining(false)
      setNewEventAutoAttachDivera(true)
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

  // Auto-open create dialog when action=create query param is present
  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'create') {
      setShowCreateDialog(true)
      // Remove the query param after opening the dialog to prevent reopening on refresh
      router.replace('/events', { scroll: false })
    }
  }, [searchParams, router])

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-4 min-h-20">
          <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
            <div className="flex items-center gap-2 md:gap-3 min-w-0">
              <div className="flex h-9 w-9 md:h-11 md:w-11 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600 to-red-600 text-2xl shadow-lg flex-shrink-0">
                <Calendar className="h-5 w-5 md:h-6 md:w-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg md:text-2xl font-bold tracking-tight">Ereignisse</h1>
                {selectedEvent && (
                  <p className="text-xs md:text-sm text-muted-foreground hidden sm:block truncate">
                    Aktiv: {selectedEvent.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <Button onClick={() => setShowCreateDialog(true)} size="sm" className="hidden sm:flex">
              <Plus className="mr-2 h-4 w-4" />
              Neues Ereignis
            </Button>
            <Button onClick={() => setShowCreateDialog(true)} size="icon" className="sm:hidden">
              <Plus className="h-5 w-5" />
            </Button>

            {/* Desktop Navigation */}
            {!isMobile && (
              <PageNavigation currentPage="events" hasSelectedEvent={!!selectedEvent} />
            )}

            {/* Mobile Navigation */}
            {isMobile && (
              <MobileNavigation hasSelectedEvent={!!selectedEvent} />
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
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
                            <CardTitle className="text-lg flex items-center gap-2">
                              {event.name}
                              {event.training_flag && (
                                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                              )}
                            </CardTitle>
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
                            <CardTitle className="text-lg text-muted-foreground flex items-center gap-2">
                              {event.name}
                              {event.training_flag && (
                                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                              )}
                            </CardTitle>
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
        <Dialog open={showCreateDialog} onOpenChange={handleCreateDialogChange}>
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
                onCheckedChange={(checked) => {
                  setNewEventTraining(checked)
                  if (checked) setNewEventAutoAttachDivera(false)
                }}
              />
              <Label htmlFor="training-mode">Übungsmodus</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="auto-attach-divera"
                checked={newEventAutoAttachDivera}
                onCheckedChange={(checked) => {
                  setNewEventAutoAttachDivera(checked)
                  if (checked) setNewEventTraining(false)
                }}
              />
              <Label htmlFor="auto-attach-divera">Divera-Notfälle automatisch anhängen</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleCreateDialogChange(false)}>
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

      {/* Mobile Bottom Navigation */}

      <MobileBottomNavigation currentPage="events" hasSelectedEvent={!!selectedEvent} />

    </ProtectedRoute>
  )
}

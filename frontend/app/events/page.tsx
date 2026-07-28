'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useEvent } from '@/lib/contexts/event-context'
import { apiClient } from '@/lib/api-client'
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
import { Plus, Archive, ArchiveRestore, Search, Trash2, GraduationCap, Loader2, Siren, FileText, FileSpreadsheet, Download } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { PageNavigation } from '@/components/page-navigation'
import { ProtectedRoute } from '@/components/protected-route'
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { useIsMobile } from '@/components/ui/use-mobile'

export default function EventsPage() {
  const t = useTranslations('events')
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
  const [reportLoadingId, setReportLoadingId] = useState<string | null>(null)
  const [auditLoadingId, setAuditLoadingId] = useState<string | null>(null)
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

  const handleReportExport = async (event: Event) => {
    setReportLoadingId(event.id)
    try {
      const blob = await apiClient.exportEventReport(event.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Mirror backend slug: lowercase, umlauts transliterated, non-alnum -> "-"
      const slug = event.name
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ereignis'
      const date = new Date().toISOString().slice(0, 10)
      a.download = `einsatzbericht-${slug}-${date}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('page.reportExportFailed'))
    } finally {
      setReportLoadingId(null)
    }
  }

  const handleAuditExport = async (event: Event) => {
    setAuditLoadingId(event.id)
    try {
      const blob = await apiClient.exportEventAudit(event.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // Mirror backend slug: lowercase, umlauts transliterated, non-alnum -> "-"
      const slug = event.name
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ereignis'
      const date = new Date().toISOString().slice(0, 10)
      a.download = `audit-${slug}-${date}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('page.auditExportFailed'))
    } finally {
      setAuditLoadingId(null)
    }
  }

  // Compact export control: one button, both formats in a dropdown.
  const renderExportMenu = (event: Event) => {
    const busy = reportLoadingId === event.id || auditLoadingId === event.id
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={busy} title={t('page.exportTitle')}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {t('page.export')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleReportExport(event)} className="cursor-pointer">
            <FileText className="mr-2 h-4 w-4" />
            {t('page.exportReport')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAuditExport(event)} className="cursor-pointer">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {t('page.exportAudit')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
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
        } else if (e.key === 's' || e.key === 'S') {
          router.push('/settings')
          return
        } else if (e.key === 'h' || e.key === 'H') {
          router.push('/help')
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
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('page.title')}</h1>
            {selectedEvent && (
              <Badge variant="secondary" className="hidden sm:inline-flex flex-shrink-0">
                {t('page.activeBadge', { name: selectedEvent.name })}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <Button onClick={() => setShowCreateDialog(true)} size="sm" className="hidden sm:flex">
              <Plus className="size-3.5" />
              {t('page.newEvent')}
            </Button>
            <Button onClick={() => setShowCreateDialog(true)} size="icon" className="sm:hidden" aria-label={t('page.newEvent')}>
              <Plus className="size-4" />
            </Button>

            {/* Desktop Navigation */}
            {!isMobile && (
              <PageNavigation currentPage="events" hasSelectedEvent={!!selectedEvent} />
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
                  placeholder={t('page.searchPlaceholder')}
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
                    ? t('page.emptyNone')
                    : t('page.emptySearch')}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-8">
                {/* Active Events Section */}
                {filteredActiveEvents.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold mb-4">{t('page.activeSection')}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredActiveEvents.map((event) => (
                        <Card
                          key={event.id}
                          data-testid="event-card"
                          className={`cursor-pointer transition-all hover:border-primary/50 ${
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
                              <div>{t('page.incidentCount', { count: event.incident_count })}</div>
                              <div>{t('page.createdAt', { date: new Date(event.created_at).toLocaleDateString('de-CH') })}</div>
                              <div>{t('page.lastActivity', { date: new Date(event.last_activity_at).toLocaleString('de-CH') })}</div>
                            </div>

                            <div className="mt-4 flex gap-2">
                              <Button
                                className="flex-1"
                                onClick={() => handleSelectEvent(event)}
                              >
                                {t('page.select')}
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                title={t('page.archive')}
                                onClick={() => {
                                  setTargetEvent(event)
                                  setShowArchiveDialog(true)
                                }}
                              >
                                <Archive className="size-4" />
                              </Button>
                              {renderExportMenu(event)}
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
                    <h2 className="text-xl font-semibold mb-4 text-muted-foreground">{t('page.archivedSection')}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredArchivedEvents.map((event) => (
                        <Card
                          key={event.id}
                          data-testid="event-card"
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
                              <div>{t('page.incidentCount', { count: event.incident_count })}</div>
                              <div>{t('page.createdAt', { date: new Date(event.created_at).toLocaleDateString('de-CH') })}</div>
                              <div>{t('page.archivedAt', { date: new Date(event.archived_at!).toLocaleDateString('de-CH') })}</div>
                            </div>

                            <div className="mt-4 flex gap-2">
                              <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => handleUnarchive(event)}
                              >
                                <ArchiveRestore className="size-4" />
                                {t('page.restore')}
                              </Button>
                              {renderExportMenu(event)}
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('page.delete')}
                                className="hover:bg-destructive/10"
                                onClick={() => {
                                  setTargetEvent(event)
                                  setShowDeleteDialog(true)
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
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
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{t('createDialog.title')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="event-name" className="text-sm font-semibold text-muted-foreground">{t('createDialog.nameLabel')}</Label>
                <Input
                  id="event-name"
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  placeholder={t('createDialog.namePlaceholder')}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newEventName.trim() && !isCreating) {
                      handleCreateEvent()
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('createDialog.modeLabel')}</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={!newEventTraining}
                    onClick={() => {
                      setNewEventTraining(false)
                      setNewEventAutoAttachDivera(true)
                    }}
                    className={`flex items-center gap-2 rounded-lg border-2 p-3 text-left text-sm font-medium transition-colors ${
                      !newEventTraining
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-muted hover:border-muted-foreground/25'
                    }`}
                  >
                    <Siren className="h-4 w-4 shrink-0" />
                    {t('createDialog.modeLive')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={newEventTraining}
                    onClick={() => {
                      setNewEventTraining(true)
                      setNewEventAutoAttachDivera(false)
                    }}
                    className={`flex items-center gap-2 rounded-lg border-2 p-3 text-left text-sm font-medium transition-colors ${
                      newEventTraining
                        ? 'border-warning bg-warning/5 text-warning-foreground'
                        : 'border-muted hover:border-muted-foreground/25'
                    }`}
                  >
                    <GraduationCap className="h-4 w-4 shrink-0" />
                    {t('createDialog.modeTraining')}
                  </button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleCreateDialogChange(false)}>
                {t('createDialog.cancel')}
              </Button>
              <Button onClick={handleCreateEvent} disabled={isCreating || !newEventName.trim()}>
                {isCreating && <Loader2 className="size-4 animate-spin" />}
                {isCreating ? t('createDialog.creating') : t('createDialog.create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {/* Archive Confirmation Dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('archiveDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p>{t('archiveDialog.question', { name: targetEvent?.name ?? '' })}</p>
            <p className="text-sm text-muted-foreground">
              {t('archiveDialog.note')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveDialog(false)}>
              {t('archiveDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleArchive}>
              {t('archiveDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="font-semibold text-destructive">
              {t('deleteDialog.warning')}
            </p>
            <p>{t('deleteDialog.question', { name: targetEvent?.name ?? '' })}</p>
            <p className="text-sm text-muted-foreground">
              {t('deleteDialog.note', { count: targetEvent?.incident_count || 0 })}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              {t('deleteDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('deleteDialog.confirm')}
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

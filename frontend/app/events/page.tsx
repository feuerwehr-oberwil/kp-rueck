'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useFormatter, useNow, useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useEvent } from '@/lib/contexts/event-context'
import { apiClient } from '@/lib/api-client'
import type { Event } from '@/lib/types/incidents'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { DetailField } from '@/components/kanban/detail-field'
import { Plus, Archive, Trash2, GraduationCap, Loader2, Siren, FileText, FileSpreadsheet, ReceiptText, MoreHorizontal, ChevronRight, ArrowRight, FileWarning, Package } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { EventRestliste } from '@/components/events/event-restliste'
import { TrainingBadge } from '@/components/training-mode-chrome'
import { PageNavigation } from '@/components/page-navigation'
import { ProtectedRoute } from '@/components/protected-route'
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation"
import { useIsMobile } from '@/components/ui/use-mobile'

/**
 * Mirror of the backend slug (`slugify_event_name`, api/exports.py): lowercase,
 * umlauts transliterated, every other run of non-alphanumerics collapsed to "-".
 * The downloads name themselves client-side, so the two have to agree.
 */
function slugifyEventName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'ereignis'
  )
}

/**
 * The two open-work counts as quiet amber chips on a list row. The full
 * Restliste stays on the active-event banner, where it can be worked off —
 * every other row only needs to say whether something is still open there.
 * Renders nothing when nothing is.
 */
function RestlisteRowChips({ eventId }: { eventId: string }) {
  const t = useTranslations('events.page')
  const [counts, setCounts] = useState<{ rapport: number; pickups: number } | null>(null)

  useEffect(() => {
    let alive = true
    apiClient
      .getEventRestliste(eventId)
      .then((d) => {
        if (alive) setCounts({ rapport: d.missing_rapport.length, pickups: d.open_pickups.length })
      })
      // A missing chip is not an error state — same reasoning as EventRestliste.
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [eventId])

  if (!counts || (counts.rapport === 0 && counts.pickups === 0)) return null
  const chip =
    'inline-flex shrink-0 items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-xs text-warning-foreground whitespace-nowrap'
  return (
    <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
      {counts.rapport > 0 && (
        <span className={chip}>
          <FileWarning className="size-3" />
          {t('rowMissingRapport', { count: counts.rapport })}
        </span>
      )}
      {counts.pickups > 0 && (
        <span className={chip}>
          <Package className="size-3" />
          {t('rowOpenPickups', { count: counts.pickups })}
        </span>
      )}
    </div>
  )
}

/** Hand a fetched blob to the browser as a download, then clean up the object URL. */
function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export default function EventsPage() {
  const t = useTranslations('events')
  // Dates were hardcoded to `de-CH`, which is wrong on a board running in
  // French — and `fr` ships. `useFormatter` follows the active locale, and gives
  // the three date lines one format instead of two (one had a time, two did not).
  const format = useFormatter()
  // Anchor for the relative ages ("vor 3 Tagen"), refreshed each minute so an
  // open tab does not quietly age — and required: `relativeTime` without an
  // explicit now logs an ENVIRONMENT_FALLBACK error per row in dev.
  const now = useNow({ updateInterval: 60_000 })
  // The board's own «Übung» wording, so one drill is not called two things.
  const tTraining = useTranslations('kanban')
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
  // Archive and delete run against the same button the operator just clicked, and
  // delete takes every incident under the event with it — so both get the same
  // in-flight guard the create button already has (disabled + spinner), and the
  // confirmation cannot be dismissed while the request is out.
  const [isArchiving, setIsArchiving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // The archive is auskunft, not workspace: collapsed by default, and only
  // forced open while a search actually matches something in it.
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [reportLoadingId, setReportLoadingId] = useState<string | null>(null)
  const [auditLoadingId, setAuditLoadingId] = useState<string | null>(null)
  const [einsaetzeLoadingId, setEinsaetzeLoadingId] = useState<string | null>(null)
  const [gPrefixActive, setGPrefixActive] = useState(false)
  const gPrefixTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // One fetch for the whole page: every event card's Restliste asks the same
  // question (may I offer the Abholliste?), and the answer is a station setting.
  const [printerEnabled, setPrinterEnabled] = useState(false)

  useEffect(() => {
    apiClient.getPrinterStatus()
      .then((status) => setPrinterEnabled(status.enabled))
      // No printer API (Railway, agent-less deployment) is not an error here —
      // it is simply a board that does not print.
      .catch(() => setPrinterEnabled(false))
  }, [])

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

  // The selected event, as long as it is still active: it renders as the pinned
  // banner, and the row list carries everything else. Deliberately taken from
  // the unfiltered list — a search may narrow the rows, but never hides where
  // the board currently stands.
  const bannerEvent = useMemo(
    () => (selectedEvent ? activeEvents.find((e) => e.id === selectedEvent.id) : undefined),
    [activeEvents, selectedEvent]
  )
  const rowEvents = useMemo(
    () => filteredActiveEvents.filter((e) => e.id !== bannerEvent?.id),
    [filteredActiveEvents, bannerEvent]
  )
  const archiveListOpen = archiveOpen || (searchQuery.trim() !== '' && filteredArchivedEvents.length > 0)

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

  /**
   * Restliste → the card itself (plan 25, §6). A count that cannot be opened is
   * a number to write down by hand, which is exactly the work this replaces —
   * so every row lands on the board with that Schadenplatz highlighted.
   */
  const handleOpenIncident = (event: Event, incidentId: string) => {
    setSelectedEvent(event)
    router.push(`/?highlight=${encodeURIComponent(incidentId)}`)
  }

  const handleArchive = async () => {
    if (!targetEvent || isArchiving) return
    setIsArchiving(true)
    try {
      await archiveEvent(targetEvent.id)
      setShowArchiveDialog(false)
      setTargetEvent(null)
    } catch (error) {
      console.error('Failed to archive event:', error)
    } finally {
      setIsArchiving(false)
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
    if (!targetEvent || isDeleting) return
    setIsDeleting(true)
    try {
      await deleteEvent(targetEvent.id)
      setShowDeleteDialog(false)
      setTargetEvent(null)
    } catch (error) {
      console.error('Failed to delete event:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleReportExport = async (event: Event) => {
    setReportLoadingId(event.id)
    try {
      const blob = await apiClient.exportEventReport(event.id)
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `einsatzbericht-${slugifyEventName(event.name)}-${date}.pdf`)
    } catch (err) {
      // German first, technical detail second. `apiClient` ALWAYS throws an Error, so the
      // old `err instanceof Error ? err.message : t(…)` never reached the translation — the
      // operator got the raw backend text ("Report export failed: Internal Server Error")
      // in an otherwise German interface, and the message below was dead copy.
      toast.error(t('page.reportExportFailed'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setReportLoadingId(null)
    }
  }

  const handleAuditExport = async (event: Event) => {
    setAuditLoadingId(event.id)
    try {
      const blob = await apiClient.exportEventAudit(event.id)
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `audit-${slugifyEventName(event.name)}-${date}.xlsx`)
    } catch (err) {
      // Same reasoning as the report export above.
      toast.error(t('page.auditExportFailed'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setAuditLoadingId(null)
    }
  }

  /**
   * Einsätze (plan 25, §7): one wide row per Schadenplatz — including the ones
   * without a rapport, so the gaps stay visible. Somebody retypes it into the
   * billing system by hand; it just does not need that name on it.
   */
  const handleEinsaetzeExport = async (event: Event) => {
    setEinsaetzeLoadingId(event.id)
    try {
      const blob = await apiClient.exportEventEinsaetze(event.id)
      const date = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `einsaetze-${slugifyEventName(event.name)}-${date}.xlsx`)
    } catch (err) {
      toast.error(t('page.einsaetzeExportFailed'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setEinsaetzeLoadingId(null)
    }
  }

  // One quiet ⋯ per row: the three exports for every event, plus the row's
  // one-way action — Archivieren, or Löschen once archived. The destructive
  // item lives only in here, so the list shows no standing red at rest.
  const renderRowMenu = (event: Event, archived: boolean) => {
    const busy =
      reportLoadingId === event.id || auditLoadingId === event.id || einsaetzeLoadingId === event.id
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('page.rowActions')}
            title={t('page.rowActions')}
            disabled={busy}
            onClick={(e) => e.stopPropagation()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => handleReportExport(event)} className="cursor-pointer">
            <FileText className="mr-2 h-4 w-4" />
            {t('page.exportReport')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAuditExport(event)} className="cursor-pointer">
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {t('page.exportAudit')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleEinsaetzeExport(event)} className="cursor-pointer">
            <ReceiptText className="mr-2 h-4 w-4" />
            {t('page.exportEinsaetze')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {archived ? (
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:text-destructive"
              onClick={() => {
                setTargetEvent(event)
                setShowDeleteDialog(true)
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('page.delete')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => {
                setTargetEvent(event)
                setShowArchiveDialog(true)
              }}
            >
              <Archive className="mr-2 h-4 w-4" />
              {t('page.archive')}
            </DropdownMenuItem>
          )}
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
          <div className="mx-auto max-w-[1100px]">

            {/* Search bar */}
            <div className="mb-6">
              <SearchInput
                placeholder={t('page.searchPlaceholder')}
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
            </div>

            {/* The active event is not a row — it is a banner, pinned above the
                list, with the only other red on the page and the Restliste
                expanded here only. Search never hides "you are here". */}
            {bannerEvent && (
              <div
                data-testid="event-card"
                className="relative mb-6 overflow-hidden rounded-lg border border-border bg-muted/30 p-4 pl-5"
              >
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary" />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-xl font-semibold">{bannerEvent.name}</h2>
                      {bannerEvent.training_flag && <TrainingBadge label={tTraining('dashboard.training')} />}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {t('page.incidentCountShort', { count: bannerEvent.incident_count })}
                      {' · '}
                      {t('page.lastActivityRelative', { rel: format.relativeTime(new Date(bannerEvent.last_activity_at), now) })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button onClick={() => router.push('/')}>
                      {t('page.toBoard')}
                      <ArrowRight className="size-4" />
                    </Button>
                    {renderRowMenu(bannerEvent, false)}
                  </div>
                </div>
                {/* The Restliste (plan 25, §6/V-8): what is still open, with a
                    way into each incident. Expanded only here — this is the one
                    event whose gaps are being worked. Renders nothing when
                    nothing is open. */}
                <EventRestliste
                  eventId={bannerEvent.id}
                  onOpenIncident={(incidentId) => handleOpenIncident(bannerEvent, incidentId)}
                  printerEnabled={printerEnabled}
                />
              </div>
            )}

            {/* The banner is search-immune by design, so a fruitless search
                still needs its answer below it — only the "one event, and it
                is selected" idle case renders nothing extra. */}
            {rowEvents.length === 0 && filteredArchivedEvents.length === 0 &&
            (!bannerEvent || searchQuery.trim() !== '') ? (
              <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                {events.length === 0 ? t('page.emptyNone') : t('page.emptySearch')}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Every other event is a row: name, count, open-work chips,
                    age — and its actions always visible, but quiet. */}
                {rowEvents.length > 0 && (
                  <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card">
                    {rowEvents.map((event) => (
                      <div
                        key={event.id}
                        data-testid="event-card"
                        onClick={() => handleSelectEvent(event)}
                        className="flex min-h-[52px] cursor-pointer items-center gap-3 px-4 py-2 hover:bg-muted/50"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-[15px] font-medium">{event.name}</span>
                          {event.training_flag && <TrainingBadge label={tTraining('dashboard.training')} />}
                        </div>
                        <RestlisteRowChips eventId={event.id} />
                        <span className="hidden w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
                          {t('page.incidentCountShort', { count: event.incident_count })}
                        </span>
                        <span className="hidden w-28 shrink-0 text-right text-sm tabular-nums text-muted-foreground md:block">
                          {format.relativeTime(new Date(event.last_activity_at), now)}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectEvent(event)
                          }}
                        >
                          {t('page.select')}
                        </button>
                        {renderRowMenu(event, false)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Archive: collapsed auskunft at the foot of the list, not a
                    second grid. A matching search forces it open. */}
                {filteredArchivedEvents.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setArchiveOpen((o) => !o)}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight
                        className={`size-4 transition-transform ${archiveListOpen ? 'rotate-90' : ''}`}
                      />
                      {t('page.archiveDisclosure', { count: filteredArchivedEvents.length })}
                    </button>
                    {archiveListOpen && (
                      <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card opacity-70">
                        {filteredArchivedEvents.map((event) => (
                          <div
                            key={event.id}
                            data-testid="event-card"
                            className="flex min-h-[52px] items-center gap-3 px-4 py-2"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="truncate text-[15px] font-medium text-muted-foreground">{event.name}</span>
                              {event.training_flag && <TrainingBadge label={tTraining('dashboard.training')} />}
                            </div>
                            <span className="hidden w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
                              {t('page.incidentCountShort', { count: event.incident_count })}
                            </span>
                            <span className="hidden w-28 shrink-0 text-right text-sm tabular-nums text-muted-foreground md:block">
                              {format.relativeTime(new Date(event.archived_at!), now)}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                              onClick={() => handleUnarchive(event)}
                            >
                              {t('page.restore')}
                            </button>
                            {renderRowMenu(event, true)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* Create Event Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={handleCreateDialogChange}>
          <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{t('createDialog.title')}</DialogTitle>
            </DialogHeader>
            {/* `DetailField` rows, boxed controls — the grammar of the new-Einsatz modal. */}
            <div className="space-y-1 py-2">
              <DetailField label={t('createDialog.nameLabel')} htmlFor="event-name">
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
              </DetailField>
              <DetailField label={t('createDialog.modeLabel')} alignStart>
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
              </DetailField>
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
      <Dialog open={showArchiveDialog} onOpenChange={(open) => { if (!open && isArchiving) return; setShowArchiveDialog(open) }}>
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
            <Button variant="outline" onClick={() => setShowArchiveDialog(false)} disabled={isArchiving}>
              {t('archiveDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleArchive} disabled={isArchiving}>
              {isArchiving && <Loader2 className="size-4 animate-spin" />}
              {t('archiveDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => { if (!open && isDeleting) return; setShowDeleteDialog(open) }}>
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
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>
              {t('deleteDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting && <Loader2 className="size-4 animate-spin" />}
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

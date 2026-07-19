'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { apiClient, type ApiIncident, type ApiEvent } from '@/lib/api-client'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent, apiEventToEvent } from '@/lib/contexts/event-context'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Clock, Eye, Siren, Truck, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Minus, Binoculars, MapIcon, RefreshCw, LayoutGrid, Phone, LogOut, WifiOff } from 'lucide-react'
import { columns, getTimeSince, ageChipClass } from '@/lib/kanban-utils'
import { getIncidentTypeLabel } from '@/lib/incident-types'
import { cn } from '@/lib/utils'
import { type OperationStatus } from '@/lib/contexts/operations-context'

// Dynamically import map to avoid SSR issues with Leaflet
const ViewerMapView = dynamic(() => import('./viewer-map'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-muted rounded-lg">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ),
})

type ViewMode = 'kanban' | 'map'

// Map API status to internal status
function mapApiStatus(apiStatus: string): OperationStatus {
  const statusMap: Record<string, OperationStatus> = {
    eingegangen: 'incoming',
    reko: 'ready',
    reko_done: 'rekoDone',
    disponiert: 'enroute',
    einsatz: 'active',
    einsatz_beendet: 'returning',
    abschluss: 'complete',
  }
  return statusMap[apiStatus] || 'incoming'
}

// Format location address
function formatLocation(address: string | null, unknownLabel: string): string {
  if (!address) return unknownLabel
  // Split by comma and take first part (street address)
  const parts = address.split(',')
  return parts[0].trim()
}

// Priority visual configuration
const priorityStyles = {
  high: {
    icon: 'text-red-400',
    card: 'border-l-2 border-l-red-400/50',
  },
  medium: {
    icon: 'text-muted-foreground',
    card: '',
  },
  low: {
    icon: 'text-muted-foreground/50',
    card: '',
  },
} as const

interface ViewerIncidentCardProps {
  incident: ApiIncident
  isExpanded?: boolean
  onClick?: () => void
}

function ViewerIncidentCard({ incident, isExpanded = false, onClick }: ViewerIncidentCardProps) {
  const t = useTranslations('viewer')
  const [currentTime, setCurrentTime] = useState(new Date())

  // Auto-update time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  const priority = incident.priority || 'low'
  const priorityConfig = priorityStyles[priority as keyof typeof priorityStyles]

  // Calculate time in current status
  const statusChangedAt = incident.status_changed_at
    ? new Date(incident.status_changed_at)
    : new Date(incident.created_at)
  const dispatchTime = new Date(incident.created_at)
  const minutesInStatus = Math.floor((currentTime.getTime() - statusChangedAt.getTime()) / (1000 * 60))
  const isOverOneHour = minutesInStatus >= 60

  return (
    <Card
      className={cn(
        'border border-border/50 bg-card/80 backdrop-blur-sm p-4 transition-all',
        priorityConfig?.card,
        onClick && 'cursor-pointer hover:bg-muted/30',
        isExpanded && 'ring-2 ring-primary/20 border-primary'
      )}
      onClick={onClick}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <div className="flex items-center flex-shrink-0 mt-0.5">
              {priority === 'high' ? (
                <ChevronUp className={cn('h-4 w-4', priorityConfig?.icon)} />
              ) : priority === 'medium' ? (
                <Minus className={cn('h-4 w-4', priorityConfig?.icon)} />
              ) : (
                <ChevronDown className={cn('h-4 w-4', priorityConfig?.icon)} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-base text-foreground leading-tight break-words">
                {formatLocation(incident.location_address || incident.title, t('common.unknown'))}
              </h3>
              {incident.title && incident.location_address && incident.title !== incident.location_address && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {incident.title}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* REKO Status Icon */}
            {(incident.has_completed_reko || incident.reko_arrived_at) && (
              <div
                className={`p-1.5 rounded-md ${
                  incident.has_completed_reko
                    ? 'bg-emerald-100 dark:bg-emerald-900/30'
                    : ''
                }`}
                title={
                  incident.has_completed_reko
                    ? t('card.rekoCompleted')
                    : t('card.rekoOnSite')
                }
              >
                <Binoculars
                  className={`h-4 w-4 ${
                    incident.has_completed_reko
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  }`}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Siren className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground break-words">
            {getIncidentTypeLabel(incident.type)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-sm text-muted-foreground">
              {dispatchTime.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <span
            className={cn('font-mono text-xs', ageChipClass(statusChangedAt))}
            title={isOverOneHour ? t('card.overOneHour') : undefined}
          >
            {getTimeSince(statusChangedAt)}
          </span>
        </div>

        {/* Description - always show if present */}
        {incident.description && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
              {incident.description}
            </p>
          </div>
        )}

        {/* Contact info */}
        {incident.contact && (
          <div className="flex items-start gap-2 text-xs">
            <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{incident.contact}</span>
          </div>
        )}

        {/* Vehicle assignments */}
        {incident.assigned_vehicles && incident.assigned_vehicles.length > 0 && (
          <div className="border-t pt-3 space-y-1.5 text-xs">
            <div className="flex items-start gap-1.5">
              <Truck className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex flex-wrap gap-1 min-w-0">
                {incident.assigned_vehicles.map((vehicle) => (
                  <Badge key={vehicle.assignment_id} variant="secondary" className="text-xs px-1.5 py-0.5 font-normal">
                    {vehicle.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

interface ViewerColumnProps {
  column: {
    id: string
    title: string
    status: string[]
    color: string
  }
  incidents: ApiIncident[]
}

function ViewerColumn({ column, incidents }: ViewerColumnProps) {
  const t = useTranslations('viewer')
  const tk = useTranslations('kanban')
  return (
    <div className="flex min-w-[320px] max-w-[420px] flex-1 flex-col">
      <div className={cn(
        'mb-2 rounded-lg border border-border px-3 py-2',
        column.color
      )}>
        <h2 className="text-balance text-sm font-semibold text-foreground">{tk(`columns.${column.id}`)}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('common.incidentCount', { count: incidents.length })}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-2 rounded-lg min-h-[200px]">
        {incidents.map((incident) => (
          <ViewerIncidentCard
            key={incident.id}
            incident={incident}
          />
        ))}
      </div>
    </div>
  )
}

export default function ViewerPage() {
  const t = useTranslations('viewer')
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const { user, loading: authLoading, logout } = useAuth()
  const router = useRouter()
  const { selectedEvent, setSelectedEvent } = useEvent()

  // Two ways to reach this board:
  //  - link token (public, event-scoped) — original behaviour
  //  - logged-in viewer (cookie auth, no token) — for shared/kiosk PCs
  const isAuthMode = !token && !!user
  const authEventId = selectedEvent?.id ?? null

  const [event, setEvent] = useState<ApiEvent | null>(null)
  const [incidents, setIncidents] = useState<ApiIncident[]>([])
  const [availableEvents, setAvailableEvents] = useState<ApiEvent[]>([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Whether we ever loaded data successfully. A wall display runs unattended
  // for hours: a failed *refresh* must keep showing last-known data (with a
  // stale banner) and keep retrying — only a failed FIRST load may show the
  // full-screen error, because someone is standing there setting it up.
  const hasDataRef = useRef(false)

  const loadData = useCallback(async () => {
    try {
      const data = token
        ? await apiClient.getViewerData(token)
        : authEventId
          ? await apiClient.getViewerDataAuthenticated(authEventId)
          : null
      // Network blips resolve to undefined (soft-degrade): keep the last
      // state; the stale banner takes over once refreshes stall.
      if (!data) return
      setEvent(data.event)
      setIncidents(data.incidents)
      setError(null)
      setLastRefresh(new Date())
      hasDataRef.current = true
    } catch (err) {
      console.error('Failed to load viewer data:', err)
      if (!hasDataRef.current) {
        setError(
          token
            ? t('page.invalidLink')
            : t('page.loadFailed')
        )
      }
    } finally {
      setLoading(false)
    }
  }, [token, authEventId])

  // Authenticated mode: load events for the selector and ensure one is selected.
  useEffect(() => {
    if (!isAuthMode) return
    let cancelled = false
    apiClient
      .getEvents(false)
      .then((res) => {
        if (cancelled) return
        const events = res.events ?? []
        setAvailableEvents(events)
        if (!selectedEvent) {
          // Prefer a live (non-training) event, else fall back to the first.
          const preferred = events.find((e) => !e.training_flag) ?? events[0]
          if (preferred) {
            setSelectedEvent(apiEventToEvent(preferred))
          } else {
            setError(t('page.noEvents'))
            setLoading(false)
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('page.eventsLoadFailed'))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [isAuthMode, selectedEvent, setSelectedEvent])

  // Initial load
  useEffect(() => {
    if (!token && !isAuthMode) {
      // No link token and not logged in.
      if (!authLoading) {
        setError(t('page.missingToken'))
        setLoading(false)
      }
      return
    }
    if (token || authEventId) {
      loadData()
    }
  }, [token, isAuthMode, authEventId, authLoading, loadData])

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (error) return
    if (!token && !authEventId) return
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [token, authEventId, error, loadData])

  // Group incidents by column status
  const incidentsByColumn = useMemo(() => {
    const grouped: Record<string, ApiIncident[]> = {}

    columns.forEach((col) => {
      grouped[col.id] = []
    })

    incidents.forEach((incident) => {
      const status = mapApiStatus(incident.status)
      const column = columns.find((col) => col.status.includes(status))
      if (column) {
        grouped[column.id].push(incident)
      }
    })

    return grouped
  }, [incidents])

  // Get active incidents for map (exclude completed)
  const activeIncidents = useMemo(() => {
    return incidents.filter(inc => inc.status !== 'abschluss')
  }, [incidents])

  // Stale when refreshes have stalled for ~6 poll cycles (5s interval).
  // Derived from lastRefresh so it covers every failure mode — thrown
  // errors, network soft-fails, and anything else that stops updates.
  const isStale = lastRefresh !== null && currentTime.getTime() - lastRefresh.getTime() > 30_000

  if (error) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <Eye className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <div className="text-destructive text-xl font-semibold mb-2">
            {t('page.accessRequired')}
          </div>
          <div className="text-muted-foreground">{error}</div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Stale-data banner: refreshes stalled but last-known data stays up */}
      {isStale && lastRefresh && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-400"
        >
          <WifiOff className="h-4 w-4 flex-shrink-0" />
          <span>
            {t('page.staleBanner', {
              time: lastRefresh.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            })}
          </span>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">
            {event?.name || t('page.eventFallback')}
          </h1>
          {event?.training_flag && (
            <Badge variant="secondary" className="flex-shrink-0">{t('common.training')}</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* Event selector (only for a logged-in viewer on a shared/kiosk PC) */}
          {isAuthMode && availableEvents.length > 0 && (
            <select
              value={selectedEvent?.id ?? ''}
              onChange={(e) => {
                const ev = availableEvents.find((x) => x.id === e.target.value)
                if (ev) setSelectedEvent(apiEventToEvent(ev))
              }}
              className="h-8 max-w-[12rem] rounded-lg border border-border bg-muted/50 px-2 text-sm"
              aria-label={t('page.selectEvent')}
            >
              {availableEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                  {ev.training_flag ? t('page.trainingSuffix') : ''}
                </option>
              ))}
            </select>
          )}

          {/* View Toggle */}
          <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
            <Button
              variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2.5 gap-1.5"
              onClick={() => setViewMode('kanban')}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline text-xs">{t('page.kanbanView')}</span>
            </Button>
            <Button
              variant={viewMode === 'map' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-2.5 gap-1.5"
              onClick={() => setViewMode('map')}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline text-xs">{t('page.mapView')}</span>
            </Button>
          </div>

          {/* Viewer banner */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{t('page.readOnly')}</span>
          </div>

          {/* Refresh indicator */}
          {lastRefresh && (
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3" />
              <span>
                {lastRefresh.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          )}

          {/* Clock */}
          <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-base font-semibold tabular-nums">
              {currentTime.toLocaleTimeString('de-CH')}
            </span>
          </div>

          {/* Logout (only for a logged-in viewer — token guests have no session) */}
          {isAuthMode && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={async () => {
                await logout()
                router.push('/login')
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline text-xs">{t('page.logout')}</span>
            </Button>
          )}
        </div>
      </header>

      {/* Main Content */}
      {viewMode === 'kanban' ? (
        <main className="flex-1 overflow-x-auto p-4 bg-muted/30 dark:bg-zinc-950/20">
          <div className="flex h-full gap-3">
            {/* Active columns get the full height; the completed pile is collapsed by default */}
            {columns.filter((c) => !c.collapsible).map((column) => (
              <ViewerColumn
                key={column.id}
                column={column}
                incidents={incidentsByColumn[column.id] || []}
              />
            ))}
            {(() => {
              const completeCol = columns.find((c) => c.collapsible)
              if (!completeCol) return null
              const completeIncidents = incidentsByColumn[completeCol.id] || []
              return (
                <>
                  <button
                    onClick={() => setShowCompleted((v) => !v)}
                    className="flex w-10 flex-shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 text-xs font-semibold tracking-wide text-muted-foreground transition-colors hover:bg-muted/50"
                    title={showCompleted ? t('page.hideCompleted') : t('page.showCompleted')}
                  >
                    {showCompleted ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    <span className="[writing-mode:vertical-rl] rotate-180">
                      {t('page.completedColumn', { count: completeIncidents.length })}
                    </span>
                  </button>
                  {showCompleted && (
                    <ViewerColumn column={completeCol} incidents={completeIncidents} />
                  )}
                </>
              )
            })()}
          </div>
        </main>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Map */}
          <main className="flex-1 p-4">
            <ViewerMapView
              incidents={activeIncidents}
              selectedIncidentId={selectedIncidentId}
              onMarkerClick={setSelectedIncidentId}
            />
          </main>

          {/* Incident Sidebar */}
          <aside className="w-80 border-l border-border bg-card/30 backdrop-blur-sm overflow-y-auto flex-shrink-0 hidden md:block">
            <div className="p-4">
              <h2 className="text-lg font-bold mb-3">
                {t('page.incidentsHeading', { count: activeIncidents.length })}
              </h2>

              <div className="space-y-3">
                {activeIncidents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t('common.noActiveIncidents')}
                  </p>
                ) : (
                  activeIncidents.map((incident) => (
                    <ViewerIncidentCard
                      key={incident.id}
                      incident={incident}
                      isExpanded={selectedIncidentId === incident.id}
                      onClick={() => setSelectedIncidentId(
                        selectedIncidentId === incident.id ? null : incident.id
                      )}
                    />
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-background/95 backdrop-blur-sm px-4 md:px-6 py-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Eye className="h-4 w-4" />
            <span className="hidden sm:inline">{t('page.footerReadOnly')}</span>
            <span className="sm:hidden">{t('page.readOnly')}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t('common.incidentCount', { count: incidents.length })}
          </div>
        </div>
      </footer>
    </div>
  )
}

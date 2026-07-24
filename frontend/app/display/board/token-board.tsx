'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { apiClient, type ApiIncident, type ApiEvent, type ApiIncidentGroup, type ApiViewerData } from '@/lib/api-client'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Clock, Eye, Siren, Truck, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Minus, Binoculars, Phone, WifiOff } from 'lucide-react'
import { columns, getTimeSince, ageChipClass } from '@/lib/kanban-utils'
import { getIncidentTypeLabel } from '@/lib/incident-types'
import { cn } from '@/lib/utils'
import { type OperationStatus } from '@/lib/contexts/operations-context'
import { buildSituationData, viewerGroupsToIncidentGroups } from '@/lib/viewer-data'
import { IncidentDetailModal } from '@/components/display/incident-detail-modal'

// Read-only board rendered from a share token (no login). Mirrors the command
// post board but sourced from the public viewer-data endpoint, which returns
// only the event + incidents (no resource contexts). Used by /display/board
// when a ?token= is present.

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

function formatLocation(address: string | null, unknownLabel: string): string {
  if (!address) return unknownLabel
  return address.split(',')[0].trim()
}

const priorityStyles = {
  high: { icon: 'text-red-400', card: 'border-l-2 border-l-red-400/50' },
  medium: { icon: 'text-muted-foreground', card: '' },
  low: { icon: 'text-muted-foreground/50', card: '' },
} as const

function TokenIncidentCard({ incident, groups, onClick }: { incident: ApiIncident; groups: ApiIncidentGroup[]; onClick: () => void }) {
  const t = useTranslations('display.tokenBoard')
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(interval)
  }, [])

  const priority = incident.priority || 'low'
  const priorityConfig = priorityStyles[priority as keyof typeof priorityStyles]

  const statusChangedAt = incident.status_changed_at
    ? new Date(incident.status_changed_at)
    : new Date(incident.created_at)
  const dispatchTime = new Date(incident.created_at)
  const minutesInStatus = Math.floor((currentTime.getTime() - statusChangedAt.getTime()) / (1000 * 60))
  const isOverOneHour = minutesInStatus >= 60
  const group = incident.group_id ? groups.find((item) => String(item.id) === String(incident.group_id)) : undefined
  const stopIndex = group?.stop_ids.map(String).indexOf(String(incident.id)) ?? -1

  return (
    <Card
      className={cn(
        'border border-border/50 bg-card/80 backdrop-blur-sm p-4 transition-all cursor-pointer hover:border-border hover:bg-card',
        priorityConfig?.card,
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
                {incident.location_display || formatLocation(incident.location_address || incident.title, t('unknown'))}
              </h3>
              {incident.title && incident.location_address && incident.title !== incident.location_address && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{incident.title}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {(incident.has_completed_reko || incident.reko_arrived_at) && (
              <div
                className={`p-1.5 rounded-md ${incident.has_completed_reko ? 'bg-emerald-100 dark:bg-emerald-900/30' : ''}`}
                title={incident.has_completed_reko ? t('rekoCompleted') : t('rekoOnSite')}
              >
                <Binoculars
                  className={`h-4 w-4 ${incident.has_completed_reko ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Siren className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground break-words">{getIncidentTypeLabel(incident.type)}</span>
        </div>

        {group && (
          <Badge variant="outline" className="w-fit text-xs" style={{ borderColor: group.color ?? undefined }}>
            {group.name}{stopIndex >= 0 ? ` · ${stopIndex + 1}/${group.stop_ids.length}` : ''}
          </Badge>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="font-mono text-sm text-muted-foreground">
              {dispatchTime.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <span
            className={cn('font-mono text-xs', ageChipClass(statusChangedAt))}
            title={isOverOneHour ? t('overOneHour') : undefined}
          >
            {getTimeSince(statusChangedAt)}
          </span>
        </div>

        {incident.description && (
          <div className="border-t pt-3">
            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{incident.description}</p>
          </div>
        )}

        {incident.contact && (
          <div className="flex items-start gap-2 text-xs">
            <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{incident.contact}</span>
          </div>
        )}

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

function TokenColumn({ column, incidents, groups, onIncidentClick }: { column: typeof columns[number]; incidents: ApiIncident[]; groups: ApiIncidentGroup[]; onIncidentClick: (incidentId: string) => void }) {
  const t = useTranslations('display.tokenBoard')
  const tk = useTranslations('kanban')
  return (
    <div className="flex min-w-[320px] max-w-[420px] flex-1 flex-col">
      <div className={cn('mb-2 rounded-lg border border-border px-3 py-2', column.color)}>
        <h2 className="text-balance text-sm font-semibold text-foreground">{tk(`columns.${column.id}`)}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('incidentCount', { count: incidents.length })}</p>
      </div>
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto p-2 rounded-lg">
        {incidents.map((incident) => (
          <TokenIncidentCard key={incident.id} incident={incident} groups={groups} onClick={() => onIncidentClick(incident.id)} />
        ))}
      </div>
    </div>
  )
}

export function TokenBoard({ token }: { token: string }) {
  const t = useTranslations('display.tokenBoard')

  const [event, setEvent] = useState<ApiEvent | null>(null)
  const [incidents, setIncidents] = useState<ApiIncident[]>([])
  const [groups, setGroups] = useState<ApiIncidentGroup[]>([])
  const [payload, setPayload] = useState<ApiViewerData | null>(null)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const hasDataRef = useRef(false)

  const loadData = useCallback(async () => {
    try {
      const data = await apiClient.getViewerData(token)
      if (!data) return
      setEvent(data.event)
      setIncidents(data.incidents)
      setGroups(data.groups ?? [])
      setPayload(data)
      setError(null)
      setLastRefresh(new Date())
      hasDataRef.current = true
    } catch (err) {
      console.error('Failed to load display token data:', err)
      if (!hasDataRef.current) setError(t('invalidLink'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (error) return
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [error, loadData])

  const incidentsByColumn = useMemo(() => {
    const grouped: Record<string, ApiIncident[]> = {}
    columns.forEach((col) => { grouped[col.id] = [] })
    incidents.forEach((incident) => {
      const status = mapApiStatus(incident.status)
      const column = columns.find((col) => col.status.includes(status))
      if (column) grouped[column.id].push(incident)
    })
    return grouped
  }, [incidents])

  // Detail dialog: rebuild the operation view-model (crew, materials, vehicles
  // from the payload's assignments) so tapping a card shows the full picture.
  const situation = useMemo(() => (payload ? buildSituationData(payload) : null), [payload])
  const detailGroups = useMemo(() => (payload ? viewerGroupsToIncidentGroups(payload) : []), [payload])
  const selectedOperation = useMemo(
    () => situation?.operations.find((op) => op.id === selectedIncidentId) ?? null,
    [situation, selectedIncidentId],
  )

  const isStale = lastRefresh !== null && currentTime.getTime() - lastRefresh.getTime() > 30_000

  if (error) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <Eye className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
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
      {isStale && lastRefresh && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/15 px-4 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-400"
        >
          <WifiOff className="h-4 w-4 flex-shrink-0" />
          <span>{t('staleBanner', { time: lastRefresh.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}</span>
        </div>
      )}

      <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 md:px-6 py-2 min-h-14">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">{event?.name || t('eventFallback')}</h1>
          {event?.training_flag && <Badge variant="secondary" className="flex-shrink-0">{t('training')}</Badge>}
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{t('readOnly')}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-base font-semibold tabular-nums">{currentTime.toLocaleTimeString('de-CH')}</span>
          </div>
        </div>
      </header>

      {/* min-h-0 lets the columns scroll internally instead of the last card
          getting clipped at the container edge. */}
      <main className="flex-1 min-h-0 overflow-x-auto p-4 bg-muted/30 dark:bg-zinc-950/20">
        <div className="flex h-full gap-3">
          {columns.filter((c) => !c.collapsible).map((column) => (
            <TokenColumn key={column.id} column={column} incidents={incidentsByColumn[column.id] || []} groups={groups} onIncidentClick={setSelectedIncidentId} />
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
                  title={showCompleted ? t('hideCompleted') : t('showCompleted')}
                >
                  {showCompleted ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                  <span className="[writing-mode:vertical-rl] rotate-180">{t('completedColumn', { count: completeIncidents.length })}</span>
                </button>
                {showCompleted && <TokenColumn column={completeCol} incidents={completeIncidents} groups={groups} onIncidentClick={setSelectedIncidentId} />}
              </>
            )
          })()}
        </div>
      </main>

      <IncidentDetailModal
        operation={selectedOperation}
        open={!!selectedOperation}
        onOpenChange={(open) => { if (!open) setSelectedIncidentId(null) }}
        personnelOverride={situation?.personnel ?? []}
        materialsOverride={situation?.materials ?? []}
        groupsOverride={detailGroups}
      />
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { apiClient, type ApiViewerData } from '@/lib/api-client'
import { Loader2, Eye, ChevronDown, ChevronRight } from 'lucide-react'
import { DisplayStaleBanner } from '@/components/display/display-stale-banner'
import { columns, ageLevel } from '@/lib/kanban-utils'
import { useCollapsedSections } from '@/lib/hooks/use-collapsed-sections'
import { getIncidentLocationLabel } from '@/lib/incident-types'
import { cn } from '@/lib/utils'
import { buildSituationData, viewerGroupsToIncidentGroups } from '@/lib/viewer-data'
import { DisplayIncidentCard } from '@/components/display/incident-card'
import { IncidentDetailModal } from '@/components/display/incident-detail-modal'
import { useDisplaySearch } from '@/lib/contexts/display-search-context'
import { CARD_VIEW_PRESETS } from '@/lib/card-view'
import { filterIncidents } from '@/lib/incident-search'
import { type Operation } from '@/lib/contexts/operations-context'
import { type Material } from '@/lib/contexts/materials-context'
import type { GroupResources, IncidentGroup } from '@/lib/types/groups'

// Read-only board rendered from a share token (no login). The SAME board and the
// SAME cards as the logged-in display — it differs only in where the data comes
// from (the public viewer-data endpoint instead of the contexts) and therefore in
// what the payload can carry: the Reko-Summaries come along but without their
// photos, and there are no Rapport flags and no report endpoints, since those
// need a session. Each missing block is absent rather than empty, so the card
// simply loses that section.
// Used by /display/board when a ?token= is present.

/** Per-device fold state for the share-link board (see useCollapsedSections). */
const TOKEN_BOARD_COLLAPSE_KEY = 'kp-display-token-board-collapsed'

/**
 * Bring a column back into the scrollport after a fold changed the board's
 * width. A DOM query rather than a ref: the folded strip and the open column are
 * two different elements, so the ref that survives a toggle is whichever one
 * just unmounted — `data-column` is on both. `inline: 'nearest'` brings it back
 * only as far as it takes to be visible, so a column that never left does not
 * jump.
 */
function keepColumnInView(columnKey: string) {
  document
    .querySelector(`[data-column="${columnKey}"]`)
    ?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
}

/** What in this column has sat past the board's own warning threshold? */
function columnAlarms(operations: Operation[]): Operation[] {
  return operations.filter((op) => ageLevel(op.statusChangedAt || op.dispatchTime) !== 'normal')
}

/**
 * One column, identical to the logged-in display board's — chevron, title,
 * overdue dot and count pill, and the same fold for every column including
 * ABGESCHLOSSEN. The share link used to draw its own header (a subtitle line
 * instead of the pill) and hang «Abgeschlossen» off a separate dashed strip.
 */
function TokenColumn({ column, operations, groups, groupResources, materials, collapsed, onToggle, onIncidentClick }: {
  column: typeof columns[number]
  operations: Operation[]
  groups: IncidentGroup[]
  /** groupId → the route's resolved resources, shared by all of its stops. */
  groupResources: Map<string, GroupResources>
  materials: Material[]
  collapsed: boolean
  onToggle: () => void
  onIncidentClick: (incidentId: string) => void
}) {
  const t = useTranslations('display')
  const tk = useTranslations('kanban')
  // The dot alone only says "something", which is the one thing a viewer can't
  // act on — so it names the overdue incidents on hover, up to three.
  const alarms = columnAlarms(operations)
  const hasAlarm = alarms.length > 0
  const alarmTitle = hasAlarm
    ? t('board.columnAlarmTitle', {
        count: alarms.length,
        titles: alarms.slice(0, 3).map((op) => getIncidentLocationLabel(op)).join(', ')
          + (alarms.length > 3 ? ` ${t('board.columnAlarmMore', { count: alarms.length - 3 })}` : ''),
      })
    : undefined
  const alarmDotClass = 'cursor-help rounded-full bg-red-500 transition-[transform,box-shadow] hover:scale-150 hover:shadow-[0_0_0_3px_oklch(from_var(--color-red-500)_l_c_h/0.25)]'

  // Folded: a thin bar that still carries the count and the overdue mark, so a
  // closed column never hides the thing that needed looking at.
  if (collapsed) {
    return (
      <button
        type="button"
        data-column={column.id}
        onClick={onToggle}
        className={cn('flex w-12 flex-shrink-0 flex-col items-center gap-3 rounded-lg border border-border py-3 transition-colors hover:bg-foreground/5', column.color)}
        title={t('board.collapsedColumnTitle', { title: tk(`columns.${column.id}`), count: operations.length })}
      >
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span className="relative inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-foreground/10 px-1.5 text-xs font-bold tabular-nums text-foreground">
          {operations.length}
          {hasAlarm && <span title={alarmTitle} aria-label={alarmTitle} className={cn('absolute -right-1 -top-1 h-2 w-2', alarmDotClass)} />}
        </span>
        <span className="text-xs font-bold uppercase tracking-tight text-foreground [writing-mode:vertical-rl]">
          {tk(`columns.${column.id}`)}
        </span>
      </button>
    )
  }

  return (
    <div data-column={column.id} className="flex flex-1 flex-col min-w-[280px] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        className={cn('mb-2 w-full cursor-pointer rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-foreground/5', column.color)}
      >
        <div className="flex items-center gap-2">
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <h2 className="flex-1 truncate text-sm font-bold uppercase tracking-tight text-foreground">{tk(`columns.${column.id}`)}</h2>
          {hasAlarm && <span title={alarmTitle} aria-label={alarmTitle} className={cn('h-2 w-2 flex-shrink-0', alarmDotClass)} />}
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-foreground/10 px-1.5 text-xs font-bold tabular-nums text-foreground">
            {operations.length}
          </span>
        </div>
      </button>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg p-2">
        {operations.map((operation) => {
          const auftrag = operation.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
          return (
            <DisplayIncidentCard
              key={operation.id}
              operation={operation}
              cardView={CARD_VIEW_PRESETS.alles}
              materials={materials}
              auftrag={auftrag}
              auftragResources={auftrag ? groupResources.get(auftrag.id) ?? null : null}
              onClick={() => onIncidentClick(operation.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

export function TokenBoard({ token }: { token: string }) {
  const t = useTranslations('display.tokenBoard')

  // No event state here on purpose: the display layout loads the token's
  // Ereignis itself for the top bar, so this board only needs the payload.
  const [payload, setPayload] = useState<ApiViewerData | null>(null)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  // EVERY column folds, ABGESCHLOSSEN included and closed to start with —
  // the same one mechanism the logged-in display board uses, rather than the
  // separate dashed strip this board used to hang it off.
  const collapsedColumns = useCollapsedSections(
    TOKEN_BOARD_COLLAPSE_KEY,
    columns.filter((c) => c.collapsible).map((c) => c.id),
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const { query } = useDisplaySearch()
  // Always the whole card, never the «Ansicht» preset — even more clearly than
  // on the session board: a share link opens on somebody else's machine, so the
  // preset it would read is a stranger's, set for a board they do not have.
  const hasDataRef = useRef(false)

  const loadData = useCallback(async () => {
    try {
      const data = await apiClient.getViewerData(token)
      if (!data) return
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

  // Detail dialog: rebuild the operation view-model (crew, materials, vehicles
  // from the payload's assignments) so tapping a card shows the full picture.
  // The search reads it too — the same predicate as the command-post board, so
  // a crew member's name finds the card here as well, not just an address.
  const situation = useMemo(() => (payload ? buildSituationData(payload) : null), [payload])

  // groupId → Auftrag name, so searching a route's name also matches its stops.
  // The token payload carries the groups itself; there is no groups context on a
  // share link.
  const detailGroups = useMemo(() => (payload ? viewerGroupsToIncidentGroups(payload) : []), [payload])

  const groupNames = useMemo(
    () => new Map(detailGroups.map((group) => [group.id, group.name])),
    [detailGroups],
  )

  const matchingIds = useMemo(() => {
    if (!query.trim() || !situation) return null
    return new Set(
      filterIncidents(situation.operations, query, situation.materials, groupNames).map((op) => op.id),
    )
  }, [query, situation, groupNames])

  // The board's own view-model, column by column — the payload order, which is
  // the order the command post persisted (`Incident.position`), untouched.
  const operationsByColumn = useMemo(() => {
    const grouped: Record<string, Operation[]> = {}
    columns.forEach((col) => { grouped[col.id] = [] })
    ;(situation?.operations ?? [])
      .filter((op) => !matchingIds || matchingIds.has(op.id))
      .forEach((op) => {
        const column = columns.find((col) => col.status.includes(op.status))
        if (column) grouped[column.id].push(op)
      })
    return grouped
  }, [situation, matchingIds])

  // Route-owned resources, resolved to names. The Auftrag rows in the share
  // payload carry raw resource ids and the payload already carries the roster,
  // the fleet and the Material — so this costs no extra request, and it is the
  // only way a stop can say who is standing at its address (the stop itself owns
  // nothing). Unresolvable ids are skipped rather than printed as UUIDs; the
  // roster is checked-in-only, same rule the incident crew mapping follows.
  const groupResources = useMemo(() => {
    const resolved = new Map<string, GroupResources>()
    if (!payload) return resolved
    const nameById = new Map<string, string>()
    for (const person of payload.personnel) nameById.set(String(person.id), person.name)
    for (const vehicle of payload.vehicles) nameById.set(String(vehicle.id), vehicle.name)
    for (const material of payload.materials) nameById.set(String(material.id), material.name)
    for (const group of payload.groups ?? []) {
      const resources: GroupResources = { vehicles: [], personnel: [], materials: [] }
      for (const assignment of group.assignments ?? []) {
        if (assignment.unassigned_at) continue
        const resourceId = String(assignment.resource_id)
        const name = nameById.get(resourceId)
        if (!name) continue
        const item = { assignmentId: String(assignment.id), resourceId, name }
        if (assignment.resource_type === 'vehicle') resources.vehicles.push({ ...item, driverStay: assignment.driver_stay })
        else if (assignment.resource_type === 'personnel') resources.personnel.push({ ...item, isLeader: assignment.is_leader })
        else resources.materials.push(item)
      }
      resolved.set(String(group.id), resources)
    }
    return resolved
  }, [payload])

  // Folding a column shoves every column after it sideways, and ABGESCHLOSSEN
  // sits at the far right: opening it used to widen something outside the
  // scrollport, so the click read as "nothing happened". Both directions, so
  // closing brings the strip back too. Only on a click, never on mount.
  const keepInViewRef = useRef<string | null>(null)
  const collapseSignature = columns.map((c) => (collapsedColumns.isCollapsed(c.id) ? '1' : '0')).join('')
  useEffect(() => {
    const columnKey = keepInViewRef.current
    if (!columnKey) return
    keepInViewRef.current = null
    keepColumnInView(columnKey)
  }, [collapseSignature])
  const selectedOperation = useMemo(
    () => situation?.operations.find((op) => op.id === selectedIncidentId) ?? null,
    [situation, selectedIncidentId],
  )

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
      <DisplayStaleBanner lastRefresh={lastRefresh} />

      {/* No header of its own: the display layout's bar already carries this
          Ereignis, the clock and the «Nur-Lesen» badge, and two bars stacked
          said the same thing twice on the screen with the least room for it. */}

      {/* min-h-0 lets the columns scroll internally instead of the last card
          getting clipped at the container edge. */}
      {/* The board's own gaps and padding — one board, two data sources. */}
      <main className="flex-1 min-h-0 overflow-x-auto p-3 bg-muted/30 dark:bg-background">
        <div className="flex h-full gap-2">
          {columns.map((column) => (
            <TokenColumn
              key={column.id}
              column={column}
              operations={operationsByColumn[column.id] || []}
              groups={detailGroups}
              groupResources={groupResources}
              materials={situation?.materials ?? []}
              collapsed={collapsedColumns.isCollapsed(column.id)}
              onToggle={() => {
                keepInViewRef.current = column.id
                collapsedColumns.toggle(column.id)
              }}
              onIncidentClick={setSelectedIncidentId}
            />
          ))}
        </div>
      </main>

      <IncidentDetailModal
        operation={selectedOperation}
        open={!!selectedOperation}
        onOpenChange={(open) => { if (!open) setSelectedIncidentId(null) }}
        personnelOverride={situation?.personnel ?? []}
        materialsOverride={situation?.materials ?? []}
        groupsOverride={detailGroups}
        groupResourcesOverride={groupResources}
        // The Reko photos are the one thing in the dialog that is fetched rather
        // than read out of the payload, so they need the link's own credential.
        viewerToken={token}
      />
    </div>
  )
}

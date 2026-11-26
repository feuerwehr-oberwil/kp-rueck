import { useCallback, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useIncidentTimeMode } from "@/lib/hooks/use-incident-time-mode"
import type { MapIncident } from "@/lib/map-incident"
import { sortForMapList } from "@/lib/map-list-order"
import { isIncidentStatus, isIncidentType, STATUS_TO_GROUP, type StatusGroup } from "@/lib/types/incidents"

/**
 * The Lagekarte's Einsätze, cut the ways the page draws them:
 * - `statusGroupCounts`: per status group, before any filter;
 * - `shownIncidents`: what the map shows – the status filters, plus `exceptionId` (a deep-linked
 *   or «Auf Karte anzeigen» Einsatz shows whatever the filters say);
 * - `activeIncidents`: shown and searched (the desk's header count);
 * - `sections`: the searched list by status group, each Hoch → Mittel → Niedrig, then oldest
 *   first by the age its rows show (`sortForMapList`) – split from the search-only list so a
 *   collapsed rail section still knows its count;
 * - `searchHits`: the phone's hits – every status, as the sections hold them.
 * One search for all of them: address, title, type or status.
 */
export function useMapIncidentLists({
  incidents,
  statusFilters,
  exceptionId,
  searchQuery,
}: {
  incidents: MapIncident[]
  statusFilters: Record<StatusGroup, boolean>
  exceptionId: string | null
  searchQuery: string
}) {
  const tKanban = useTranslations('kanban')
  const tIncidents = useTranslations('incidents')
  const { mode: timeMode } = useIncidentTimeMode()

  const statusGroupCounts = useMemo(() => {
    const counts: Record<StatusGroup, number> = { open: 0, active: 0, completed: 0 }
    incidents.forEach((inc) => {
      const group = STATUS_TO_GROUP[inc.status]
      if (group) counts[group]++
    })
    return counts
  }, [incidents])

  const shownIncidents = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.id === exceptionId) return true
        const group = STATUS_TO_GROUP[inc.status]
        return group && statusFilters[group]
      }),
    [incidents, statusFilters, exceptionId],
  )
  const matchesSearch = useCallback(
    (inc: MapIncident) => {
      const lowerQuery = searchQuery.toLowerCase()
      return Boolean(
        (inc.location_address && inc.location_address.toLowerCase().includes(lowerQuery)) ||
        (inc.title && inc.title.toLowerCase().includes(lowerQuery)) ||
        (isIncidentType(inc.type) && tIncidents(`types.${inc.type}`).toLowerCase().includes(lowerQuery)) ||
        (isIncidentStatus(inc.status) && tKanban(`columns.${inc.status}`).toLowerCase().includes(lowerQuery)),
      )
    },
    [searchQuery, tIncidents, tKanban],
  )
  const activeIncidents = useMemo(
    () => (searchQuery ? shownIncidents.filter(matchesSearch) : shownIncidents),
    [shownIncidents, searchQuery, matchesSearch],
  )

  const sections = useMemo(() => {
    const searched = !searchQuery ? incidents : incidents.filter(matchesSearch)
    const bySection: Record<StatusGroup, MapIncident[]> = { open: [], active: [], completed: [] }
    for (const inc of searched) {
      const group = STATUS_TO_GROUP[inc.status]
      if (group) bySection[group].push(inc)
    }
    for (const group of Object.keys(bySection) as StatusGroup[]) bySection[group] = sortForMapList(bySection[group], timeMode)
    return bySection
  }, [incidents, searchQuery, matchesSearch, timeMode])

  const searchHits = useMemo(
    () => (searchQuery ? [...sections.open, ...sections.active, ...sections.completed] : []),
    [searchQuery, sections],
  )

  return { statusGroupCounts, shownIncidents, activeIncidents, sections, searchHits }
}

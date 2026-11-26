"use client"

import { skipToken, useQuery } from "@tanstack/react-query"

import { apiClient, type ApiIncidentTimelineEvent } from "@/lib/api-client"
import { queryKeys } from "@/lib/query/keys"
import { useReader } from "@/lib/query/reader"

export interface IncidentTimelineState {
  /** Newest first, as the API returns it. */
  events: ApiIncidentTimelineEvent[] | null
  /** No answer for this incident yet; a refresh keeps the held list on screen. */
  isLoading: boolean
  failed: boolean
  reload: () => void
}

/**
 * The incident's merged history: status changes, assignments and the crew's
 * Freitext-Meldungen.
 *
 * Read **once per detail view** and handed down, because two surfaces read the
 * same feed: the Verlauf tab renders all of it, the Rapport tab renders only
 * the messages as a thread next to the Feldmeldungen.
 *
 * `enabled` is what keeps a board click cheap — the caller turns it on when one
 * of those two tabs is actually in front, and every re-enable reads again. A
 * history panel that quietly stopped updating while a running incident sat open
 * is worse than one that takes a moment to appear. A failure is non-fatal: the
 * surfaces show a retry rather than a toast.
 */
export function useIncidentTimeline(incidentId: string | null, enabled: boolean): IncidentTimelineState {
  const reader = useReader()
  const query = useQuery({
    queryKey: queryKeys.incidentTimeline.of(reader, incidentId),
    queryFn: incidentId ? () => apiClient.getIncidentTimeline(incidentId) : skipToken,
    select: (result) => result.events,
    enabled,
  })
  const events = query.data ?? null
  return {
    events,
    isLoading: query.isFetching && !events,
    failed: query.isError && !query.isFetching,
    reload: () => void query.refetch(),
  }
}

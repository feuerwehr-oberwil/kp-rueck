"use client"

import { skipToken, useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { ApiDiveraResponsesSummary } from "@/lib/api/types"
import { queryKeys } from "@/lib/query/keys"
import { usePollOptions } from "@/lib/query/poll"

/**
 * The Divera Rückmeldungen of one Ereignis, kept fresh only while a block shows them.
 *
 * The backend stores what its Divera poll already fetched and pushes
 * `divera_responses_update` when it changed, so with a live socket this reads once and then
 * on that event and on `personnel_update` (`lib/query/socket-bridge.ts`); without one it falls
 * back to the board's ~5 s rhythm. Nothing here talks to Divera. `null` until the first answer
 * — the caller shows nothing rather than a loader for a block that may not exist at all.
 * Divera not configured → it stops asking.
 */
export function useDiveraResponses(eventId: string | null, enabled: boolean): ApiDiveraResponsesSummary | null {
  const poll = usePollOptions(5000, { skipWhileWsConnected: true })
  const query = useQuery({
    queryKey: queryKeys.eventDiveraResponses.of(eventId),
    queryFn: eventId ? () => apiClient.getEventDiveraResponses(eventId) : skipToken,
    enabled: (q) => enabled && q.state.data?.reason !== "not_configured",
    ...poll,
  })
  return query.data ?? null
}

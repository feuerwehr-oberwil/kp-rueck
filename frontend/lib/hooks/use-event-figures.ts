"use client"

import { skipToken, useQuery } from "@tanstack/react-query"
import { apiClient, type ApiEventFigures } from "@/lib/api-client"
import { queryKeys } from "@/lib/query/keys"
import { usePollOptions } from "@/lib/query/poll"

export interface EventFiguresState {
  figures: ApiEventFigures | null
  /** The last load failed; `figures` keeps the last good answer (if any). */
  failed: boolean
}

/**
 * The Kennzahlen of one Ereignis, kept fresh while somebody looks at them.
 *
 * Read off `GET /events/{id}/figures` — two queries, cheap enough for a wall that
 * reloads it — whose reaction times are the PDF's own computation. Polls every 10 s while
 * `enabled`: the numbers are aggregates over the whole Ereignis, a few seconds behind the board
 * is fine, and the oldest-waiting age re-renders with each answer. A different Ereignis never
 * shows the previous one's numbers. `pauseWhenHidden` is the caller's — a wall passes false
 * (see `usePollOptions`).
 */
export function useEventFigures(
  eventId: string | null | undefined,
  { enabled = true, pauseWhenHidden = true }: { enabled?: boolean; pauseWhenHidden?: boolean } = {},
): EventFiguresState {
  const poll = usePollOptions(10_000, { pauseWhenHidden })
  const query = useQuery({
    queryKey: queryKeys.eventFigures.of(eventId),
    queryFn: eventId ? () => apiClient.getEventFigures(eventId) : skipToken,
    enabled,
    ...poll,
  })
  return { figures: query.data ?? null, failed: query.isError }
}

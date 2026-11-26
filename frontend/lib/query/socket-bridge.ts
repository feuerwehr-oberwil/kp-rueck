import type { Query, QueryClient } from "@tanstack/react-query"
import { wsClient, type WebSocketStatus, type WsEventName, type WsEvents } from "@/lib/websocket-client"
import { queryKeys } from "./keys"

/** Which cached reads to refresh: `queryKeys.x.all` or `queryKeys.x.byId(id)`. */
type Filter = (query: Query) => boolean

/** One line of the bridge: a socket event and the reads it refreshes. */
interface Route {
  /** The kinds (`queryKeys.x.all`) this event can refresh – every reader's entries. */
  kinds: readonly Filter[]
  listen: (refresh: (filter: Filter) => void) => () => void
}

/**
 * `event` refetches every read of `kinds`, or – with `only` – just the reads the payload names
 * (`queryKeys.x.byId`). Only reads someone shows refetch; the rest are marked stale and read
 * again on their next mount.
 */
function refetch<K extends WsEventName>(
  event: K,
  kinds: Route["kinds"],
  only: (payload: WsEvents[K]) => readonly Filter[] = () => kinds,
): Route {
  return { kinds, listen: (refresh) => wsClient.on(event, (payload) => only(payload).forEach(refresh)) }
}

/**
 * Which socket event refreshes which server read – the one place a read learns it changed on
 * the server. A read that the socket keeps fresh gets its line here; its hook polls with
 * `skipWhileWsConnected` for the time the socket is down.
 */
const ROUTES: readonly Route[] = [
  refetch("divera_responses_update", [queryKeys.eventDiveraResponses.all], (message) =>
    message.event_ids.map(queryKeys.eventDiveraResponses.byId),
  ),
  // A check-in or check-out changes who is still «anrückend».
  refetch("personnel_update", [queryKeys.eventDiveraResponses.all]),
  refetch("gps_sim_status", [queryKeys.gpsSimulations.all]),
]

/**
 * Connect `client` to the socket: every line of `ROUTES`, and one refetch of the socket-kept
 * reads each time the socket comes (back) up – whatever was broadcast while it was down is
 * missed for good. `QueryProvider` runs it once per tab; returns the teardown.
 */
export function bridgeSocketToQueries(client: QueryClient): () => void {
  const cache = client.getQueryCache()
  // A read that is out when its event comes may predate the change, and TanStack would join
  // it. So it gets ONE follow-up read once it settles, however many events come meanwhile: a
  // burst of check-ins still lands an answer every round trip.
  const followUps = new Set<Query>()
  const readAgain = (query: Query) => void client.invalidateQueries({ queryKey: query.queryKey, exact: true })
  const offSettled = cache.subscribe(({ type, query }) => {
    if (!followUps.has(query)) return
    // A read dropped while out (the previous user's, `provider.tsx`) never settles.
    if (type === "removed") return void followUps.delete(query)
    if (query.state.fetchStatus === "fetching") return
    followUps.delete(query)
    if (cache.get(query.queryHash) === query) readAgain(query)
  })
  const refresh = (predicate: Filter) => {
    for (const query of cache.findAll({ predicate })) {
      if (query.state.fetchStatus === "fetching") followUps.add(query)
      else readAgain(query)
    }
  }

  const offs = ROUTES.map((route) => route.listen(refresh))
  // One refetch per kind, however many events name it.
  const kinds = new Set(ROUTES.flatMap((route) => route.kinds))
  let last: WebSocketStatus = wsClient.getStatus()
  const offStatus = wsClient.onStatusChange((status) => {
    if (status === last) return // the subscription replays the current status
    last = status
    if (status !== "connected") return
    for (const kind of kinds) refresh(kind)
  })
  return () => {
    offs.forEach((off) => off())
    offStatus()
    offSettled()
  }
}

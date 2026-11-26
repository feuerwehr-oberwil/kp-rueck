import type { Query, QueryClient, QueryKey } from "@tanstack/react-query"
import { wsClient, type WebSocketStatus, type WsEventName, type WsEvents } from "@/lib/websocket-client"
import { queryKeys } from "./keys"

/** One line of the bridge: a socket event and the reads it refreshes. */
interface Route {
  /** The kinds (`queryKeys.x.all`) this event can refresh. */
  kinds: readonly (readonly [string])[]
  listen: (refresh: (queryKey: QueryKey) => void) => () => void
}

/**
 * `event` refetches every read of `kinds`, or – with `ids` – only the reads scoped to the ids
 * the payload names. Only reads someone shows refetch; the rest are marked stale and read
 * again on their next mount.
 */
function refetch<K extends WsEventName>(
  event: K,
  kinds: Route["kinds"],
  ids?: (payload: WsEvents[K]) => readonly string[],
): Route {
  return {
    kinds,
    listen: (refresh) =>
      wsClient.on(event, (payload) => {
        const scope = ids?.(payload)
        for (const kind of kinds) {
          if (!scope) refresh(kind)
          else for (const id of scope) refresh([...kind, id])
        }
      }),
  }
}

/**
 * Which socket event refreshes which server read – the one place a read learns it changed on
 * the server. A read that the socket keeps fresh gets its line here; its hook polls with
 * `skipWhileWsConnected` for the time the socket is down.
 */
const ROUTES: readonly Route[] = [
  refetch("divera_responses_update", [queryKeys.eventDiveraResponses.all], (message) => message.event_ids),
  // A check-in or check-out changes who is still «anrückend».
  refetch("personnel_update", [queryKeys.eventDiveraResponses.all]),
  refetch("gps_sim_status", [queryKeys.gpsSimulations]),
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
  const offSettled = cache.subscribe(({ query }) => {
    if (!followUps.has(query) || query.state.fetchStatus === "fetching") return
    followUps.delete(query)
    if (cache.get(query.queryHash) === query) readAgain(query)
  })
  const refresh = (queryKey: QueryKey) => {
    for (const query of cache.findAll({ queryKey })) {
      if (query.state.fetchStatus === "fetching") followUps.add(query)
      else readAgain(query)
    }
  }

  const offs = ROUTES.map((route) => route.listen(refresh))
  // One refetch per kind, however many events name it.
  const kinds = [...new Map(ROUTES.flatMap((route) => route.kinds).map((kind) => [kind[0], kind])).values()]
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

import type { QueryClient, QueryKey } from "@tanstack/react-query"
import { wsClient, type WebSocketStatus, type WsEventName, type WsEvents } from "@/lib/websocket-client"
import { queryKeys } from "./keys"

/** One line of the bridge: a socket event and the reads it refreshes. */
interface Route {
  /** The kinds (`queryKeys.x.all`) this event can refresh. */
  kinds: readonly (readonly [string])[]
  listen: (client: QueryClient) => () => void
}

/**
 * Read everything under `queryKey` again. A read already out may predate the change: it is
 * dropped and asked again, not joined (TanStack would join a first read that has no data yet).
 */
async function refresh(client: QueryClient, queryKey: QueryKey) {
  await client.cancelQueries({ queryKey })
  await client.invalidateQueries({ queryKey })
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
    listen: (client) =>
      wsClient.on(event, (payload) => {
        const scope = ids?.(payload)
        for (const kind of kinds) {
          if (!scope) void refresh(client, kind)
          else for (const id of scope) void refresh(client, [...kind, id])
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
  const offs = ROUTES.map((route) => route.listen(client))
  // One refetch per kind, however many events name it.
  const kinds = [...new Map(ROUTES.flatMap((route) => route.kinds).map((kind) => [kind[0], kind])).values()]
  let last: WebSocketStatus = wsClient.getStatus()
  const offStatus = wsClient.onStatusChange((status) => {
    if (status === last) return // the subscription replays the current status
    last = status
    if (status !== "connected") return
    for (const kind of kinds) void refresh(client, kind)
  })
  return () => {
    offs.forEach((off) => off())
    offStatus()
  }
}

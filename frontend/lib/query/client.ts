import { QueryClient } from "@tanstack/react-query"

/**
 * A QueryClient with the app's rules for server reads. `QueryProvider` makes one per tab; a
 * test makes one per render (`test-utils/render-with-intl.tsx`).
 *
 * - `retry: false`: the transport already retries a read 3× and then rejects with
 *   `NetworkError` (`lib/api/http.ts`). A second retry layer would only hold an outage longer.
 * - `networkMode: "always"`: a read goes out even when `navigator.onLine` says no. The
 *   transport decides what «offline» is and reports the outage once (stale banner, outage
 *   toast); a paused query would hide it.
 * - No refetch on focus or on the browser's `online` event: a read refreshes on its socket
 *   events (`socket-bridge.ts`), on its poll (`pollOptions`) or on a new mount.
 * - A failed refetch keeps the last good `data` (TanStack's default): what is on screen stays
 *   while offline, `isError` says the last try failed.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        networkMode: "always",
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  })
}

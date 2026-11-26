"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { useAuth } from "@/lib/contexts/auth-context"
import { makeQueryClient } from "./client"
import { queryKeys } from "./keys"
import { ReaderContext } from "./reader"
import { bridgeSocketToQueries } from "./socket-bridge"

/**
 * The tab's server-read cache (TanStack Query), wired to the socket. The root layout mounts it
 * once, inside `AuthProvider`. A user change (sign-in, sign-out, another account without a
 * sign-out) changes the reader in every private key: what is on screen is read again with the
 * new user's rights, from the first frame on (`keys.ts`). Once the reads have moved, the
 * previous user's entries are dropped. The public deployment role stays, or the standby gate
 * would treat a standby box as hosted until it is read again.
 * How to write a read: docs/FRONTEND.md › «Server reads».
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  const userId = useAuth().user?.id ?? null
  const reader = useMemo(() => ({ userId }), [userId])
  useEffect(() => bridgeSocketToQueries(client), [client])
  // Runs after the reads below have moved to the new keys (child effects run first).
  useEffect(() => {
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== queryKeys.deployment[0] && query.queryKey.at(-1) !== userId,
    })
  }, [client, userId])
  return (
    <QueryClientProvider client={client}>
      <ReaderContext.Provider value={reader}>{children}</ReaderContext.Provider>
    </QueryClientProvider>
  )
}

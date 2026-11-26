"use client"

import { useEffect, useState, type ReactNode } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { useAuth } from "@/lib/contexts/auth-context"
import { makeQueryClient } from "./client"
import { queryKeys } from "./keys"
import { bridgeSocketToQueries } from "./socket-bridge"

/**
 * The tab's server-read cache (TanStack Query), wired to the socket. The root layout mounts it
 * once, inside `AuthProvider`. A user change (sign-in, sign-out, another account) resets every
 * read but the public deployment role: what is on screen is read again with the new user's
 * rights, the rest is dropped. The deployment stays, or the standby gate would treat a standby
 * box as hosted until it is read again. The reset runs while this provider renders the new
 * user, before any panel below it does, so no panel shows the previous user's answer for a
 * frame (a token refresh can hand this tab another account without a sign-out).
 * How to write a read: docs/FRONTEND.md › «Server reads».
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  const userId = useAuth().user?.id ?? null
  useEffect(() => bridgeSocketToQueries(client), [client])
  const [readsFor, setReadsFor] = useState(userId)
  if (readsFor !== userId) {
    setReadsFor(userId)
    void client.resetQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.deployment[0] })
  }
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

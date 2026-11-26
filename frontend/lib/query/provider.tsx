"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
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
 * box as hosted until it is read again.
 * How to write a read: docs/FRONTEND.md › «Server reads».
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient)
  const userId = useAuth().user?.id ?? null
  useEffect(() => bridgeSocketToQueries(client), [client])
  const readsFor = useRef(userId)
  useEffect(() => {
    if (readsFor.current === userId) return
    readsFor.current = userId
    void client.resetQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.deployment[0] })
  }, [client, userId])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

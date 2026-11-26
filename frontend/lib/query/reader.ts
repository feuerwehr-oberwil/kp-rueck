"use client"

import { createContext, useContext } from "react"
import type { Reader } from "./keys"

/** `QueryProvider` provides it; without one (a test) nobody is signed in. */
export const ReaderContext = createContext<Reader>({ userId: null })

/**
 * The signed-in user every private read key takes (`queryKeys.x.of(reader, id)`). A context of
 * its own, so a user change re-renders every read in the same render as the change – also a
 * panel whose props did not change – and nothing else.
 */
export const useReader = () => useContext(ReaderContext)

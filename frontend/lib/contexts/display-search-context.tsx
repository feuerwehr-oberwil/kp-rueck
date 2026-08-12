"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

/**
 * The search query typed into the /display top bar, read by whichever display
 * page is mounted under it.
 *
 * A context rather than a prop because the field lives in the layout and the
 * filtering happens in the page — the layout renders `children`, so there is no
 * prop to hand down. Deliberately tiny: one string, one setter, no persistence.
 * A wall display that came back from a reload still filtered would be a display
 * quietly hiding incidents.
 */
const DisplaySearchContext = createContext<{
  query: string
  setQuery: (query: string) => void
} | null>(null)

export function DisplaySearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("")
  const value = useMemo(() => ({ query, setQuery }), [query])
  return <DisplaySearchContext.Provider value={value}>{children}</DisplaySearchContext.Provider>
}

/** Empty string outside a provider, so a page can be mounted standalone in tests. */
export function useDisplaySearch() {
  return useContext(DisplaySearchContext) ?? { query: "", setQuery: () => {} }
}

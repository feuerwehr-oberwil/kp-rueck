"use client"

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react"
import { ambiguousNameKeys, personLabelText, shownKennung } from "@/lib/person-label"

interface RosterEntry {
  id: string
  name: string
  kennung?: string | null
}

interface PersonNaming {
  /** Name keys two or more roster people share (`lib/person-label.ts`). */
  ambiguous: ReadonlySet<string>
  /** Personnel id → Kennung, for places that only hold an id and a name. */
  kennungById: ReadonlyMap<string, string | null>
}

const EMPTY: PersonNaming = { ambiguous: new Set(), kennungById: new Map() }
const PersonNamingContext = createContext<PersonNaming>(EMPTY)
const UNIT = "\u001f"
const RECORD = "\u001e"

/**
 * The roster's naming facts for everything below. Mounted by
 * `OperationsProvider` (the board roster) and by the share-token displays (the
 * payload's roster). A context of its own on purpose: it changes only when a
 * name or Kennung changes, not on every board poll, so a memoised card does not
 * repaint for it — while `PersonName` inside it still does when it matters.
 */
export function PersonNamingProvider({ roster, children }: { roster: readonly RosterEntry[]; children: ReactNode }) {
  // Keyed on a signature rather than the array: the roster is a new array on
  // every poll, the names in it rarely change. Unit/record separators cannot
  // occur in a name.
  const signature = roster.map((p) => [p.id, p.name, p.kennung ?? ""].join(UNIT)).join(RECORD)
  const value = useMemo<PersonNaming>(() => {
    const entries = signature ? signature.split(RECORD).map((row) => row.split(UNIT)) : []
    return {
      ambiguous: ambiguousNameKeys(entries.map(([, name]) => ({ name }))),
      kennungById: new Map(entries.map(([id, , kennung]) => [id, kennung || null])),
    }
  }, [signature])
  return <PersonNamingContext.Provider value={value}>{children}</PersonNamingContext.Provider>
}

/** A person as the naming knows them: by id (the Kennung is looked up), or
 *  with the Kennung in hand. */
type PersonRef = { name: string; personnelId?: string; kennung?: string | null }

/**
 * The naming facts plus the two string forms, for UI slots that only take a
 * string (`inline`, «Meier Alex · 1985») and for text that leaves the board
 * (`text`, «Meier Alex (1985)»).
 */
export function usePersonNaming() {
  const naming = useContext(PersonNamingContext)
  const resolve = useCallback(
    (person: PersonRef) => ({
      name: person.name,
      kennung: person.kennung !== undefined ? person.kennung : person.personnelId ? naming.kennungById.get(person.personnelId) : null,
    }),
    [naming],
  )
  const inline = useCallback((person: PersonRef) => personLabelText(resolve(person), naming.ambiguous, "inline"), [naming, resolve])
  const text = useCallback((person: PersonRef) => personLabelText(resolve(person), naming.ambiguous, "text"), [naming, resolve])
  return { ...naming, resolve, inline, text }
}

/**
 * A person's name as the board shows it: just the name, or — when somebody else
 * on the roster has the same one — the name followed by « · » and the Kennung
 * (or «?») in muted mono. Renders bare text for a unique name, so a roster
 * without namesakes draws exactly what it always did.
 *
 * In a slot too narrow for both, the NAME ellipsizes and the Kennung stays: it
 * is the part that tells the two apart. The full label is the name's `title`.
 *
 * `display` replaces the name text (e.g. «Unbekannt» for a blank one); the
 * ambiguity is still judged on `name`.
 */
export function PersonName({ display, ...person }: PersonRef & { display?: string }) {
  const { resolve, ambiguous } = usePersonNaming()
  const kennung = shownKennung(resolve(person), ambiguous)
  const name = display ?? person.name
  if (!kennung) return <>{name}</>
  return (
    <span className="inline-flex max-w-full min-w-0 align-bottom">
      <span className="min-w-0 truncate" title={`${name} · ${kennung}`}>
        {name}
      </span>
      <span className="shrink-0 whitespace-pre font-mono text-muted-foreground"> · {kennung}</span>
    </span>
  )
}

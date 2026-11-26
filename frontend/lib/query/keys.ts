/**
 * Every server-read key, in one place, so a hook and the socket bridge (`socket-bridge.ts`)
 * name the same cache entry. A key starts with its kind, then the id it is scoped to, then
 * the reader: `["incident-participants", incidentId, userId]`. `queryKeys.x.all` and
 * `queryKeys.x.byId(id)` are filters, not keys: they match every reader's entries – the bridge
 * refreshes by them (`all` when an event does not say which id changed).
 *
 * The key is what keeps a switch honest:
 * - Scoped to an id: the panel of Einsatz B reads B's entry, so a late answer for A lands in
 *   A's entry and never on B's screen.
 * - Scoped to the reader: every read but the public deployment role takes the `Reader` from
 *   `useReader()` (`provider.tsx`). When a token refresh hands the tab another account, every
 *   read re-renders with the new user's key in the same render – no frame shows the previous
 *   user's cached answer.
 *
 * `Register` below makes these the only keys `useQuery` takes: a literal array, or a filter,
 * does not type check, so a new read cannot leave out its reader.
 */

import type { Query } from "@tanstack/react-query"

declare const fromKeys: unique symbol
type Key<K extends readonly unknown[]> = K & { readonly [fromKeys]: true }

declare module "@tanstack/react-query" {
  interface Register {
    queryKey: Key<readonly unknown[]>
  }
}

/** Whom a private read is for. Read it with `useReader()`; a test may pass its own. */
export interface Reader {
  readonly userId: string | null
}

/** A read nobody signs in for: one entry, kept through a user change. */
const publicKind = <const K extends string>(kind: K) => [kind] as const as Key<readonly [K]>

/** Every reader's entries of a kind – a `predicate` for `findAll` / `invalidateQueries`. */
const kindFilter = (kind: string) => (query: Query) => query.queryKey[0] === kind

/** A private read with no id: one entry per reader. */
const privateKind = <const K extends string>(kind: K) => ({
  all: kindFilter(kind),
  for: (reader: Reader) => [kind, reader.userId] as const as Key<readonly [K, string | null]>,
})

/** A private read scoped to an id: one entry per id and reader. */
const scoped = <const K extends string>(kind: K) => ({
  all: kindFilter(kind),
  /** Every reader's entry for `id`, as a `predicate`. */
  byId: (id: string) => (query: Query) => query.queryKey[0] === kind && query.queryKey[1] === id,
  /** No id yet (nothing selected): the read pairs it with `skipToken` and never runs. */
  of: (reader: Reader, id: string | null | undefined) =>
    [kind, id ?? null, reader.userId] as const as Key<readonly [K, string | null, string | null]>,
})

export const queryKeys = {
  /** Deployment configuration: read once per page load. */
  deployment: publicKind("deployment"),
  integrations: privateKind("integrations"),

  gpsSimulations: privateKind("gps-simulations"),
  /** Scoped to the viewer token (`/display?token=…`); a signed-in map has none. */
  weather: scoped("weather"),

  incidentParticipants: scoped("incident-participants"),
  incidentTimeline: scoped("incident-timeline"),
  eventFigures: scoped("event-figures"),
  eventDiveraResponses: scoped("event-divera-responses"),
  eventRestliste: scoped("event-restliste"),
  standbyConflicts: scoped("standby-conflicts"),
}

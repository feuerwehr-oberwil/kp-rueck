/**
 * crew-order — the Einsatzleiter sorts first (Plan 25, decision 23).
 *
 * Wherever the crew of ONE incident is listed, the EL is the first row, so
 * «wen rufe ich an» needs no scanning. This is ordering on top of the existing
 * `LeaderBadge`, never a replacement for it — the star still marks the row.
 *
 * The boundary matters: `is_leader` is a property of ONE assignment, so one
 * incident's leader must never reorder another incident's list. This helper
 * belongs on incident-scoped lists only — the kanban card, the detail modal,
 * the participants history, an Auftrag's route resources, the WhatsApp text,
 * the radio deployment. It has no business on the roster surfaces (`/check-in`,
 * the personnel page, every resource picker), which keep their own order.
 *
 * Sorting is stable: the EL moves to the front, everyone else keeps their
 * current relative order (rank, assignment time, whatever the caller had).
 */

/** Crew given as plain names, with the leader identified by name. */
export function sortCrewByLeader(crew: readonly string[], leaderName: string | null | undefined): string[]
/** Crew given as objects, with the leader identified by an accessor (`is_leader` / `isLeader`). */
export function sortCrewByLeader<T>(crew: readonly T[], isLeader: (member: T) => boolean): T[]
export function sortCrewByLeader<T>(
  crew: readonly T[],
  leader: ((member: T) => boolean) | string | null | undefined,
): T[] {
  const isLeader =
    typeof leader === "function"
      ? (leader as (member: T) => boolean)
      : // The name form: an empty/absent leaderName marks nobody, so a crew
        // member whose name is "" is never mistaken for the EL.
        (member: T) => Boolean(leader) && member === (leader as unknown as T)

  const leaders: T[] = []
  const rest: T[] = []
  for (const member of crew) {
    if (isLeader(member)) leaders.push(member)
    else rest.push(member)
  }
  // Partition rather than Array#sort: stability is the contract here, and the
  // two buckets each preserve input order by construction.
  return leaders.length > 0 ? [...leaders, ...rest] : [...crew]
}

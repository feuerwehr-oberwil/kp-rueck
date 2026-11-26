/**
 * Every server-read key, in one place, so a hook and the socket bridge (`socket-bridge.ts`)
 * name the same cache entry. A key starts with its kind, then the id it is scoped to:
 * `["incident-participants", id]`. The kind alone (`queryKeys.x.all`) matches every id –
 * the bridge invalidates by it when an event does not say which id changed.
 *
 * A key scoped to an id is what keeps a switch honest: the panel of Einsatz B reads B's
 * entry, so a late answer for A lands in A's entry and never on B's screen.
 */
const scoped = <const K extends string>(kind: K) => ({
  all: [kind] as const,
  /** No id yet (nothing selected): the read pairs it with `skipToken` and never runs. */
  of: (id: string | null | undefined) => [kind, id ?? null] as const,
})

export const queryKeys = {
  /** Deployment configuration: read once per page load. */
  deployment: ["deployment"] as const,
  integrations: ["integrations"] as const,

  gpsSimulations: ["gps-simulations"] as const,
  /** Scoped to the viewer token (`/display?token=…`); a signed-in map has none. */
  weather: scoped("weather"),

  incidentParticipants: scoped("incident-participants"),
  incidentTimeline: scoped("incident-timeline"),
  eventFigures: scoped("event-figures"),
  eventDiveraResponses: scoped("event-divera-responses"),
  eventRestliste: scoped("event-restliste"),
  standbyConflicts: scoped("standby-conflicts"),
}

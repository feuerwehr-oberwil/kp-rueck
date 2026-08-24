/**
 * Single source of truth for resource availability colours (audit UI pass).
 *
 * Personnel, vehicles and materials share one three-state availability model:
 * free, in-use, or out. Before this module the "in use / assigned" state drew
 * as orange on the display board but amber in the mobile sheets, and every
 * view hand-rolled its own emerald/amber/orange class strings. Assigned =
 * amber, available = emerald, everywhere.
 */

export type ResourceState = "available" | "assigned" | "unavailable" | "maintenance"

/** Normalize the raw personnel/vehicle/material status strings the API sends
 *  (available | assigned | planned | unavailable | maintenance) onto the
 *  shared state. Anything unknown degrades to "unavailable". */
export function toResourceState(status: string | null | undefined): ResourceState {
  switch (status) {
    case "available":
      return "available"
    case "assigned":
    case "planned":
      return "assigned"
    case "maintenance":
      return "maintenance"
    default:
      return "unavailable"
  }
}

/**
 * A person's availability as the board must READ it, not as the API happens to store it.
 *
 * A Reko is an Auftrag: that person is out looking at something and cannot be sent anywhere else.
 * It is not an incident assignment though, so it never sets `status: "assigned"` — which left
 * five people on Reko drawn emerald and counted in «7 verfügbar» while all five were out.
 * The header number is the one thing a Kommandant reads off this board, so it has to mean what
 * it says.
 *
 * A REAL Auftrag is the same case, and had the same bug. A route's crew is held on the group,
 * not on any incident, so the event-scoped reconciliation in the operations context never saw
 * it — five people driving a Sturm route read as «verfügbar» in the sidebar and in the counter
 * above it. `isOnAuftrag` is set by the board from the groups context; see `Person`.
 *
 * Deliberately NOT folded into `toResourceState`: that one normalizes an API status string and is
 * shared with vehicles and material, which have no Reko.
 */
export function personResourceState(
  p: { status?: string | null; isReko?: boolean; isOnAuftrag?: boolean },
): ResourceState {
  const base = toResourceState(p.status)
  return base === "available" && (p.isReko || p.isOnAuftrag) ? "assigned" : base
}

/**
 * Is this person tied up right now, as the sidebar card draws it?
 *
 * Wider than `personResourceState`: a Fahrer or Magaziner keeps
 * `status: "available"` (a special function is not an incident assignment) but
 * cannot be sent somewhere else, and the card has always drawn them amber.
 * The "nur verfügbare" sidebar filter has to agree with that icon — a filtered
 * list that still shows amber entries reads as broken.
 *
 * Deliberately separate from `personResourceState`, which feeds the
 * «7 verfügbar» counters and the Status-Tafel; widening those is a numbers
 * decision, not a filtering one.
 */
export function isPersonOccupied(
  p: {
    status?: string | null
    isReko?: boolean
    isOnAuftrag?: boolean
    isDriver?: boolean
    isMagazin?: boolean
    isTelefondienst?: boolean
    isKommandoposten?: boolean
  },
): boolean {
  return (
    p.status === "assigned" ||
    !!p.isReko ||
    !!p.isOnAuftrag ||
    !!p.isDriver ||
    !!p.isMagazin ||
    !!p.isTelefondienst ||
    !!p.isKommandoposten
  )
}

/**
 * Does this person match a free-text roster query?
 *
 * Name, rank and tags are the obvious half; the other half is the Ereignis
 * role the person carries – typing "telefondienst" or "kommandoposten" has to
 * find the person holding that function, exactly like "reko" and "fahrer"
 * (and the driver's vehicle name) always did. One matcher, shared by the
 * sidebar filter and the assignment dialog, so the two searches can never
 * disagree about who "Telefondienst" is.
 */
export function personMatchesQuery(
  p: {
    name: string
    role?: string | null
    tags?: string[] | null
    isReko?: boolean
    isDriver?: boolean
    driverVehicleName?: string | null
    isMagazin?: boolean
    isTelefondienst?: boolean
    isKommandoposten?: boolean
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    p.name.toLowerCase().includes(q) ||
    // role is null for quick-added people — don't crash the search
    (!!p.role && p.role.toLowerCase().includes(q)) ||
    (!!p.isReko && "reko".includes(q)) ||
    (!!p.isDriver && ("fahrer".includes(q) || "driver".includes(q))) ||
    (!!p.driverVehicleName && p.driverVehicleName.toLowerCase().includes(q)) ||
    (!!p.isMagazin && "magazin".includes(q)) ||
    (!!p.isTelefondienst && "telefondienst".includes(q)) ||
    (!!p.isKommandoposten && "kommandoposten".includes(q)) ||
    (!!p.tags && p.tags.some((t) => t.toLowerCase().includes(q)))
  )
}

/**
 * A material's availability as the board must READ it.
 *
 * Three axes, one precedence, and it is the same one the API documents:
 * `outOfService` («Nicht einsatzbereit») beats deployment («Im Einsatz»), which
 * beats «Verfügbar». Readiness is a station-wide fact and wins even for
 * consumables — a broken Ölbindemittel-Fass is not "unlimited", it is broken.
 *
 * Consumables (Ölbindemittel, Schaummittel, Bindevlies …) are otherwise stocked, not lent out:
 * handing some to an incident does not make the depot empty, and nobody waits for them to come
 * back. They are flagged `consumable` in the Materialverwaltung, and the assignment picker has
 * always let them be assigned regardless of status — only the Status-Tafel still painted them
 * amber and counted them as gone, which reads as «wir haben kein Ölbindemittel mehr».
 *
 * Non-consumables are unchanged: one Tauchpumpe assigned is one Tauchpumpe away.
 *
 * Deliberately NOT reading the API's `status` field for readiness: it is a legacy mirror of
 * `out_of_service`, and the board overwrites it per Ereignis with the deployment state.
 */
export function materialResourceState(
  m: { status?: string | null; consumable?: boolean; outOfService?: boolean },
): ResourceState {
  if (m.outOfService) return "unavailable"
  if (m.consumable) return "available"
  return toResourceState(m.status)
}

/**
 * A vehicle's availability, by the same precedence.
 *
 * Vehicles used to consult no state at all: the fleet list carried `status` and
 * nothing on the board ever read it, so a unit recorded as defective drew green
 * and could be put on an incident. `assigned` is passed in because deployment is
 * per-Ereignis and lives in the incident assignments, not on the vehicle row.
 */
export function vehicleResourceState(
  v: { outOfService?: boolean; assigned?: boolean },
): ResourceState {
  if (v.outOfService) return "unavailable"
  return v.assigned ? "assigned" : "available"
}

/** What a sidebar footer counts: free, spoken for, and the roster behind both. */
export interface ResourceSummary {
  free: number
  bound: number
  total: number
}

/**
 * The crew counter, computed from the SAME predicate the list is filtered with.
 *
 * The footer used to count `status === "available"` straight off the API while
 * the list, its icons and «Nur Verfügbare zeigen» all went through
 * `isPersonOccupied` — so people on Reko, driving, in the Magazin or on
 * Telefondienst were hidden from the list and counted as free underneath it.
 * «14 verfügbar» over nine visible rows is the one number a Kommandant reads in
 * half a second, and it was wrong by five.
 *
 * Deliberately no breakdown by Reko / Fahrer / Magazin / Telefondienst: the foot
 * of the sidebar carries one number and its counterpart, not a five-part
 * statistic. Who is bound where is answered by clicking the row.
 */
export function summarizeRoster(
  personnel: readonly Parameters<typeof isPersonOccupied>[0][],
): ResourceSummary {
  const bound = personnel.reduce((n, p) => (isPersonOccupied(p) ? n + 1 : n), 0)
  return { free: personnel.length - bound, bound, total: personnel.length }
}

/** The material counter, from the same helper the material list is filtered with. */
export function summarizeMaterials(
  materials: readonly Parameters<typeof materialResourceState>[0][],
): ResourceSummary {
  const free = materials.reduce((n, m) => (materialResourceState(m) === "available" ? n + 1 : n), 0)
  return { free, bound: materials.length - free, total: materials.length }
}

/** Dot / swatch fill for a resource's availability. */
export const RESOURCE_STATE_DOT_CLASSES: Record<ResourceState, string> = {
  available: "bg-emerald-500",
  assigned: "bg-amber-500",
  unavailable: "bg-muted-foreground/40",
  maintenance: "bg-muted-foreground/40",
}

/** Outline-badge tint (text + border) for the same states. */
export const RESOURCE_STATE_BADGE_CLASSES: Record<ResourceState, string> = {
  available: "text-emerald-700 border-emerald-200 dark:text-emerald-400 dark:border-emerald-800/50",
  assigned: "text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800/50",
  unavailable: "text-muted-foreground border-border",
  maintenance: "text-muted-foreground border-border",
}

/**
 * Single source of truth for resource availability colours (audit UI pass).
 *
 * Personnel, vehicles and materials share one three-state availability model:
 * free, in-use, or out. Before this module the "in use / assigned" state drew
 * as orange on the display board but amber in the mobile sheets, and every
 * view hand-rolled its own emerald/amber/orange class strings. One table now,
 * read everywhere: available = green filled dot, assigned (gebunden) = hollow ink
 * ring, out = faint grey. The green is the `--free` token (app/globals.css) and this
 * module is the only place that reads it.
 *
 * Gebunden is a FACT, not a «schau hin»: amber is kept for Mittel, Am Warten,
 * ≥60′, conflicts and the stale banner (VISUAL-03, owner pick A, 2026-10-24). On a
 * storm evening 17 of 20 people are gebunden – an amber dot on each of them made
 * the whole sidebar read as a warning.
 */

import { placesMatch, type PersonPlaces } from "@/lib/person-places"

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
 * cannot be sent somewhere else, and the card draws them gebunden (the hollow ring).
 * The "nur verfügbare" sidebar filter has to agree with that icon — a filtered
 * list that still shows gebunden entries reads as broken.
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
 * (and the driver's vehicle name) always did. The third half is where the
 * person is bound right now (`places`: Einsatz number, address, Auftrag name –
 * `personPlaces`), so «12» or «Sturmholz» finds the crew out there. One matcher,
 * shared by every person picker on the board (sidebar, assignment dialogs, Reko
 * pickers, the Appell, ⌘K, the phone's people sheet – the board ones through
 * `usePersonMatcher`), so no two searches disagree about who "Telefondienst" is.
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
    places?: PersonPlaces | null
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
    (!!p.tags && p.tags.some((t) => t.toLowerCase().includes(q))) ||
    placesMatch(p.places, q)
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
  /** Material only: «nicht einsatzbereit» is neither free nor bound. A person has no such state. */
  notReady?: number
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

/**
 * The material counter, from the same helper the material list is filtered with. Three buckets,
 * the ones the «Filter & Sortierung» Status counts (`materialFacets`): frei, gebunden (on an
 * Einsatz or Auftrag) and nicht einsatzbereit. A defective device is not «gebunden» – the footer
 * used to say so, under a popover that said it was not.
 */
export function summarizeMaterials(
  materials: readonly Parameters<typeof materialResourceState>[0][],
): Required<ResourceSummary> {
  const summary = { free: 0, bound: 0, notReady: 0, total: materials.length }
  for (const material of materials) {
    const state = materialResourceState(material)
    if (state === "available") summary.free += 1
    else if (state === "assigned") summary.bound += 1
    else summary.notReady += 1
  }
  return summary
}

/** Dot / swatch for a resource's availability – the ONE table, board, phone and
 *  wall. The mark is a fixed size per surface (the call site sizes it: 8px in the
 *  board sidebars, ~10px on the wall) and every state keeps it: `assigned` is a
 *  hollow 2px ink ring drawn inset, so it is exactly as big as the filled dots.
 *  A 1.5px ring at 6px read as punctuation beside the qualification pills (hill
 *  climb r7). A mark, not a fill; never use these as a badge background. */
export const RESOURCE_STATE_DOT_CLASSES: Record<ResourceState, string> = {
  available: "bg-free",
  assigned: "bg-transparent inset-ring-2 inset-ring-foreground/80",
  unavailable: "bg-muted-foreground/40",
  maintenance: "bg-muted-foreground/40",
}

/** Outline-badge tint (text + border) for the same states. Assigned is ink: a
 *  fact, stated plainly. */
export const RESOURCE_STATE_BADGE_CLASSES: Record<ResourceState, string> = {
  available: "text-free border-free/40",
  assigned: "text-foreground border-foreground/30",
  unavailable: "text-muted-foreground border-border",
  maintenance: "text-muted-foreground border-border",
}

/** «n frei» written out beside a list or a count (the sidebar foot, a material group, the
 *  Reko pickers): the frei green as TEXT (`--free-text`), never a hand-rolled emerald step. */
export const RESOURCE_FREE_TEXT_CLASS = "text-free"

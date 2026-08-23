import { useMemo } from "react";

interface OperationWithCrew {
  id: string;
  crew: string[];
  /** Vehicle names on the incident — resolves where a DRIVER currently is. */
  vehicles?: string[];
}

/** The route-owned engagements — an Auftrag is ONE place, however many stops. */
export interface GroupEngagements {
  id: string;
  personnelNames: string[];
  vehicleNames: string[];
}

/** A Fahrer and the vehicle they drive in this Ereignis. */
export interface DriverEngagement {
  name: string;
  vehicleName: string;
}

/**
 * Derive the names of people engaged at ≥ 2 distinct PLACES, plus the count.
 *
 * A place is an incident (crew), an Auftrag (route personnel — one place, not
 * one per stop), or wherever the vehicle somebody DRIVES currently stands. It
 * used to count only `crew`, which is how a Fahrer who was also on an Auftrag
 * stood double-committed with no warning. Deduped by place, so the crew member
 * who also drove the vehicle to the SAME address is one engagement, not two.
 *
 * The Reko slot lives outside `crew` and is intentionally excluded — recon
 * staff cycle through incidents and must not raise the flag.
 */
export interface DoubleBookedPersons {
  /** Set of person names engaged at more than one place. */
  names: Set<string>;
  /** Map of person name → number of distinct places they are committed to. */
  counts: Map<string, number>;
}

export function computeDoubleBookedPersons(
  operations: OperationWithCrew[],
  groups: GroupEngagements[] = [],
  drivers: DriverEngagement[] = [],
): DoubleBookedPersons {
  const places = new Map<string, Set<string>>();
  const engage = (name: string, place: string) => {
    const set = places.get(name) ?? new Set<string>();
    set.add(place);
    places.set(name, set);
  };

  for (const op of operations) {
    for (const name of op.crew) engage(name, op.id);
  }
  for (const group of groups) {
    for (const name of group.personnelNames) engage(name, `group:${group.id}`);
  }
  // A driver is wherever their vehicle is. Same place keys as above, so the
  // dedupe holds: driving TO the incident you are also crew on is one place.
  for (const driver of drivers) {
    for (const op of operations) {
      if (op.vehicles?.includes(driver.vehicleName)) engage(driver.name, op.id);
    }
    for (const group of groups) {
      if (group.vehicleNames.includes(driver.vehicleName)) engage(driver.name, `group:${group.id}`);
    }
  }

  const counts = new Map<string, number>();
  const names = new Set<string>();
  for (const [name, set] of places) {
    counts.set(name, set.size);
    if (set.size >= 2) names.add(name);
  }
  return { names, counts };
}

export function useDoubleBookedPersons(
  operations: OperationWithCrew[],
  groups: GroupEngagements[] = [],
  drivers: DriverEngagement[] = [],
): DoubleBookedPersons {
  return useMemo(
    () => computeDoubleBookedPersons(operations, groups, drivers),
    [operations, groups, drivers],
  );
}

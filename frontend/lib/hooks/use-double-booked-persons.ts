import { useMemo } from "react";

interface OperationWithCrew {
  id: string;
  crew: readonly { personnelId: string }[];
  /** Vehicles on the incident — resolves where a DRIVER currently is. */
  vehicles?: readonly { vehicleId: string }[];
}

/** The route-owned engagements — an Auftrag is ONE place, however many stops. */
export interface GroupEngagements {
  id: string;
  personnelIds: string[];
  vehicleIds: string[];
}

/** A Fahrer and the vehicle they drive in this Ereignis. */
export interface DriverEngagement {
  personnelId: string;
  vehicleId: string;
}

/**
 * Derive the people engaged at ≥ 2 distinct PLACES, plus the count — by
 * personnel id, so two people who share a name are never counted as one.
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
  /** Personnel ids engaged at more than one place. */
  ids: Set<string>;
  /** Personnel id → number of distinct places they are committed to. */
  counts: Map<string, number>;
}

export function computeDoubleBookedPersons(
  operations: readonly OperationWithCrew[],
  groups: GroupEngagements[] = [],
  drivers: DriverEngagement[] = [],
): DoubleBookedPersons {
  const places = new Map<string, Set<string>>();
  const engage = (personnelId: string, place: string) => {
    const set = places.get(personnelId) ?? new Set<string>();
    set.add(place);
    places.set(personnelId, set);
  };

  for (const op of operations) {
    for (const { personnelId } of op.crew) engage(personnelId, op.id);
  }
  for (const group of groups) {
    for (const personnelId of group.personnelIds) engage(personnelId, `group:${group.id}`);
  }
  // A driver is wherever their vehicle is. Same place keys as above, so the
  // dedupe holds: driving TO the incident you are also crew on is one place.
  for (const driver of drivers) {
    for (const op of operations) {
      if (op.vehicles?.some((v) => v.vehicleId === driver.vehicleId)) engage(driver.personnelId, op.id);
    }
    for (const group of groups) {
      if (group.vehicleIds.includes(driver.vehicleId)) engage(driver.personnelId, `group:${group.id}`);
    }
  }

  const counts = new Map<string, number>();
  const ids = new Set<string>();
  for (const [personnelId, set] of places) {
    counts.set(personnelId, set.size);
    if (set.size >= 2) ids.add(personnelId);
  }
  return { ids, counts };
}

export function useDoubleBookedPersons(
  operations: readonly OperationWithCrew[],
  groups: GroupEngagements[] = [],
  drivers: DriverEngagement[] = [],
): DoubleBookedPersons {
  return useMemo(
    () => computeDoubleBookedPersons(operations, groups, drivers),
    [operations, groups, drivers],
  );
}

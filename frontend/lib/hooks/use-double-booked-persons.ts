import { useMemo } from "react";

interface OperationWithCrew {
  id: string;
  crew: string[];
}

/**
 * Derive the names of people who are currently assigned to ≥ 2 incidents,
 * plus the per-name assignment count. The Reko slot lives outside `crew`
 * and is intentionally excluded from this calculation — recon staff are
 * expected to cycle through multiple incidents and should not raise a
 * double-booking flag.
 */
export interface DoubleBookedPersons {
  /** Set of person names assigned to more than one incident. */
  names: Set<string>;
  /** Map of person name → number of incidents they are currently on. */
  counts: Map<string, number>;
}

export function computeDoubleBookedPersons(
  operations: OperationWithCrew[],
): DoubleBookedPersons {
  const counts = new Map<string, number>();
  for (const op of operations) {
    const seenInOp = new Set<string>();
    for (const name of op.crew) {
      if (seenInOp.has(name)) continue;
      seenInOp.add(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const names = new Set<string>();
  for (const [name, count] of counts) {
    if (count >= 2) names.add(name);
  }
  return { names, counts };
}

export function useDoubleBookedPersons(
  operations: OperationWithCrew[],
): DoubleBookedPersons {
  return useMemo(() => computeDoubleBookedPersons(operations), [operations]);
}

import { describe, expect, it } from "vitest";
import { computeDoubleBookedPersons } from "./use-double-booked-persons";

describe("computeDoubleBookedPersons", () => {
  it("flags a person assigned to two operations", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: ["Müller", "Stefan"] },
      { id: "b", crew: ["Müller", "Anna"] },
    ]);
    expect(result.names.has("Müller")).toBe(true);
    expect(result.names.has("Stefan")).toBe(false);
    expect(result.names.has("Anna")).toBe(false);
    expect(result.counts.get("Müller")).toBe(2);
    expect(result.counts.get("Stefan")).toBe(1);
  });

  it("does not flag a person on only one operation", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: ["Müller", "Stefan"] },
      { id: "b", crew: ["Anna"] },
    ]);
    expect(result.names.size).toBe(0);
    expect(result.counts.get("Müller")).toBe(1);
  });

  it("returns an empty set when there are no operations", () => {
    const result = computeDoubleBookedPersons([]);
    expect(result.names.size).toBe(0);
    expect(result.counts.size).toBe(0);
  });

  it("deduplicates a person listed twice in the same crew", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: ["Müller", "Müller", "Stefan"] },
    ]);
    expect(result.names.has("Müller")).toBe(false);
    expect(result.counts.get("Müller")).toBe(1);
  });

  it("counts triple-booking correctly", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: ["Müller"] },
      { id: "b", crew: ["Müller"] },
      { id: "c", crew: ["Müller"] },
    ]);
    expect(result.names.has("Müller")).toBe(true);
    expect(result.counts.get("Müller")).toBe(3);
  });
});

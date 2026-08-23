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

  it("counts an Auftrag membership plus a driven vehicle as two places", () => {
    // The Thomas-Graf case: on a route as personnel AND driving a vehicle that
    // stands at an incident — two commitments, no crew row anywhere.
    const result = computeDoubleBookedPersons(
      [{ id: "a", crew: [], vehicles: ["Trawa"] }],
      [{ id: "g1", personnelNames: ["Graf"], vehicleNames: [] }],
      [{ name: "Graf", vehicleName: "Trawa" }],
    );
    expect(result.names.has("Graf")).toBe(true);
    expect(result.counts.get("Graf")).toBe(2);
  });

  it("does not double-count the crew member who also drove there", () => {
    const result = computeDoubleBookedPersons(
      [{ id: "a", crew: ["Wyss"], vehicles: ["TLF"] }],
      [],
      [{ name: "Wyss", vehicleName: "TLF" }],
    );
    expect(result.names.has("Wyss")).toBe(false);
    expect(result.counts.get("Wyss")).toBe(1);
  });

  it("an Auftrag is one place, however many stops it has", () => {
    // Route personnel hold no crew row on any stop, so the group itself is
    // the single engagement.
    const result = computeDoubleBookedPersons(
      [
        { id: "stop1", crew: [] },
        { id: "stop2", crew: [] },
      ],
      [{ id: "g1", personnelNames: ["Brunner"], vehicleNames: [] }],
    );
    expect(result.names.has("Brunner")).toBe(false);
    expect(result.counts.get("Brunner")).toBe(1);
  });
});

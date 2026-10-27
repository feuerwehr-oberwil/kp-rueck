import { describe, expect, it } from "vitest";
import { computeDoubleBookedPersons } from "./use-double-booked-persons";

const crew = (...personnelIds: string[]) => personnelIds.map((personnelId) => ({ personnelId }));
const vehicles = (...vehicleIds: string[]) => vehicleIds.map((vehicleId) => ({ vehicleId }));

describe("computeDoubleBookedPersons", () => {
  it("flags a person assigned to two operations", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: crew("mueller", "stefan") },
      { id: "b", crew: crew("mueller", "anna") },
    ]);
    expect(result.ids.has("mueller")).toBe(true);
    expect(result.ids.has("stefan")).toBe(false);
    expect(result.ids.has("anna")).toBe(false);
    expect(result.counts.get("mueller")).toBe(2);
    expect(result.counts.get("stefan")).toBe(1);
  });

  it("does not flag a person on only one operation", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: crew("mueller", "stefan") },
      { id: "b", crew: crew("anna") },
    ]);
    expect(result.ids.size).toBe(0);
    expect(result.counts.get("mueller")).toBe(1);
  });

  it("does not flag two different people who share a name", () => {
    // Two «Meier Alex» on two incidents: two people, one place each.
    const result = computeDoubleBookedPersons([
      { id: "a", crew: crew("meier-1") },
      { id: "b", crew: crew("meier-2") },
    ]);
    expect(result.ids.size).toBe(0);
  });

  it("returns an empty set when there are no operations", () => {
    const result = computeDoubleBookedPersons([]);
    expect(result.ids.size).toBe(0);
    expect(result.counts.size).toBe(0);
  });

  it("deduplicates a person listed twice in the same crew", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: crew("mueller", "mueller", "stefan") },
    ]);
    expect(result.ids.has("mueller")).toBe(false);
    expect(result.counts.get("mueller")).toBe(1);
  });

  it("counts triple-booking correctly", () => {
    const result = computeDoubleBookedPersons([
      { id: "a", crew: crew("mueller") },
      { id: "b", crew: crew("mueller") },
      { id: "c", crew: crew("mueller") },
    ]);
    expect(result.ids.has("mueller")).toBe(true);
    expect(result.counts.get("mueller")).toBe(3);
  });

  it("counts an Auftrag membership plus a driven vehicle as two places", () => {
    // The Thomas-Graf case: on a route as personnel AND driving a vehicle that
    // stands at an incident — two commitments, no crew row anywhere.
    const result = computeDoubleBookedPersons(
      [{ id: "a", crew: [], vehicles: vehicles("trawa") }],
      [{ id: "g1", personnelIds: ["graf"], vehicleIds: [] }],
      [{ personnelId: "graf", vehicleId: "trawa" }],
    );
    expect(result.ids.has("graf")).toBe(true);
    expect(result.counts.get("graf")).toBe(2);
  });

  it("does not double-count the crew member who also drove there", () => {
    const result = computeDoubleBookedPersons(
      [{ id: "a", crew: crew("wyss"), vehicles: vehicles("tlf") }],
      [],
      [{ personnelId: "wyss", vehicleId: "tlf" }],
    );
    expect(result.ids.has("wyss")).toBe(false);
    expect(result.counts.get("wyss")).toBe(1);
  });

  it("an Auftrag is one place, however many stops it has", () => {
    // Route personnel hold no crew row on any stop, so the group itself is
    // the single engagement.
    const result = computeDoubleBookedPersons(
      [
        { id: "stop1", crew: [] },
        { id: "stop2", crew: [] },
      ],
      [{ id: "g1", personnelIds: ["brunner"], vehicleIds: [] }],
    );
    expect(result.ids.has("brunner")).toBe(false);
    expect(result.counts.get("brunner")).toBe(1);
  });
});

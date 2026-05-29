import { describe, expect, it } from "vitest";
import {
  RECENT_REMOVAL_WINDOW_MS,
  findRecentRemoval,
  pruneExpired,
  recordRemoval,
  type RecentRemovals,
} from "./recent-removals";

const fixedNow = 1_700_000_000_000;

describe("recordRemoval", () => {
  it("stores the latest removal under the person id", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "p1", "i1", "Bahnhof", fixedNow);
    expect(store.get("p1")).toEqual({
      incidentId: "i1",
      incidentLabel: "Bahnhof",
      removedAt: fixedNow,
    });
  });

  it("overwrites a previous removal for the same person", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "p1", "i1", "Bahnhof", fixedNow);
    recordRemoval(store, "p1", "i2", "Marktplatz", fixedNow + 1000);
    expect(store.get("p1")?.incidentId).toBe("i2");
  });
});

describe("findRecentRemoval", () => {
  it("returns null when there is no record", () => {
    const store: RecentRemovals = new Map();
    expect(findRecentRemoval(store, "p1", "i2", fixedNow)).toBeNull();
  });

  it("returns null when re-assigning to the same incident (normal undo)", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "p1", "i1", "Bahnhof", fixedNow);
    expect(findRecentRemoval(store, "p1", "i1", fixedNow + 30_000)).toBeNull();
  });

  it("returns the entry when assigning to a different incident within the window", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "p1", "i1", "Bahnhof", fixedNow);
    const result = findRecentRemoval(store, "p1", "i2", fixedNow + 30_000);
    expect(result).toEqual({
      incidentId: "i1",
      incidentLabel: "Bahnhof",
      removedAt: fixedNow,
    });
  });

  it("returns null AND prunes the entry when the record is past the window", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "p1", "i1", "Bahnhof", fixedNow);
    const expired = fixedNow + RECENT_REMOVAL_WINDOW_MS + 1;
    expect(findRecentRemoval(store, "p1", "i2", expired)).toBeNull();
    expect(store.has("p1")).toBe(false);
  });

  it("respects an overridden window — fresh entry within shorter window returns", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "p1", "i1", "Bahnhof", fixedNow);
    expect(findRecentRemoval(store, "p1", "i2", fixedNow + 3_000, 5_000)).not.toBeNull();
  });

  it("respects an overridden window — expired against shorter window returns null", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "p1", "i1", "Bahnhof", fixedNow);
    expect(findRecentRemoval(store, "p1", "i2", fixedNow + 10_000, 5_000)).toBeNull();
  });
});

describe("pruneExpired", () => {
  it("removes only entries past the window", () => {
    const store: RecentRemovals = new Map();
    recordRemoval(store, "fresh", "i1", "A", fixedNow);
    recordRemoval(store, "stale", "i2", "B", fixedNow - 10 * 60_000);
    pruneExpired(store, fixedNow);
    expect(store.has("fresh")).toBe(true);
    expect(store.has("stale")).toBe(false);
  });
});

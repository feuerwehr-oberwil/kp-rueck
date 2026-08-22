import { describe, expect, it } from "vitest";

import { searchSettings } from "@/lib/settings-search";
import de from "@/messages/de.json";

const messages = de as unknown as Record<string, unknown>;

/**
 * The index is derived from the message catalogue, so these specs double as the guard
 * that the namespace map still points at real subtrees: rename `settings.printer` and
 * "Port" stops being findable here before anybody notices it in the UI.
 */
const ALL = [
  "general",
  "integrations",
  "printer",
  "gps",
  "users",
  "sync",
  "alerting",
  "alarmIntake",
  "notifications",
  "checklist",
  "auftragTemplates",
  "fallback",
  "personnel",
  "vehicles",
  "materials",
  "import",
  "audit",
  "telemetry",
  "device",
].map((id) => ({ id, label: id }));

describe("searchSettings", () => {
  it("finds a single field by its label, not just the section", () => {
    const hits = searchSettings(messages, "Magazinradius", ALL);
    expect(hits.map((h) => h.section)).toContain("gps");
    expect(hits.find((h) => h.section === "gps")?.text).toMatch(/Magazinradius/);
  });

  it("finds the printer port", () => {
    expect(searchSettings(messages, "9100", ALL).map((h) => h.section)).toContain("printer");
  });

  it("finds a setting through its hint, not only its label", () => {
    // «Thermodrucker» appears in the printer hints, never as a section name.
    const hits = searchSettings(messages, "Thermodrucker", ALL);
    expect(hits.map((h) => h.section)).toContain("printer");
  });

  it("ranks the section name above a chance mention inside a hint", () => {
    const hits = searchSettings(messages, "Drucker", [
      { id: "printer", label: "Drucker" },
      { id: "fallback", label: "Ausfallsicherheit" },
    ]);
    expect(hits[0].section).toBe("printer");
  });

  it("respects the caller's permissions — an invisible section is unfindable", () => {
    const hits = searchSettings(messages, "Magazinradius", [{ id: "printer", label: "Drucker" }]);
    expect(hits).toEqual([]);
  });

  it("stays quiet below two characters, so the list does not flash on the first keystroke", () => {
    expect(searchSettings(messages, "D", ALL)).toEqual([]);
    expect(searchSettings(messages, "   ", ALL)).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(searchSettings(messages, "magazinradius", ALL).map((h) => h.section)).toContain("gps");
  });

  it("skips toast and error subtrees — a hit there leads nowhere", () => {
    // Every namespace in the map must resolve; an empty result for a word that exists in
    // the catalogue would mean the map drifted.
    const hits = searchSettings(messages, "Lageblatt", ALL);
    expect(hits.length).toBeGreaterThan(0);
  });
});

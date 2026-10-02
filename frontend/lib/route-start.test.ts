import { describe, expect, it } from "vitest"
import { createTranslator } from "next-intl"
import de from "@/messages/de.json"
import {
  describeRouteStart,
  describeStartOption,
  parseReportedAt,
  resolveRouteStart,
  routeStartSummary,
  type RouteStartAnchors,
} from "./route-start"

const t = createTranslator({ locale: "de", messages: de, namespace: "map.routeOptimize" }) as unknown as (
  key: string,
  values?: Record<string, string | number>,
) => string

const NOW = new Date("2026-10-02T14:40:00+02:00").getTime()
const firstStop = { coords: [47.5, 7.6] as [number, number], label: "Hauptstrasse 5" }

const anchors = (over: Partial<RouteStartAnchors> = {}): RouteStartAnchors => ({
  magazin: { coords: [47.51, 7.56], source: "settings" },
  vehicle: { coords: [47.52, 7.57], vehicleName: "TLF 1", reportedAt: new Date(NOW - 2 * 60_000) },
  firstStop,
  ...over,
})

describe("resolveRouteStart", () => {
  it("uses the requested anchor when it is available", () => {
    expect(resolveRouteStart("magazin", anchors())).toMatchObject({ mode: "magazin", source: "settings" })
    expect(resolveRouteStart("vehicle", anchors())).toMatchObject({ mode: "vehicle", vehicleName: "TLF 1" })
  })

  it("falls back to the first stop and remembers what was asked for", () => {
    expect(resolveRouteStart("vehicle", anchors({ vehicle: null }))).toMatchObject({
      mode: "first",
      requested: "vehicle",
      label: "Hauptstrasse 5",
    })
  })

  it("is null when there is nothing to start from", () => {
    expect(resolveRouteStart("first", anchors({ firstStop: null }))).toBeNull()
  })
})

describe("start option labels (before optimising)", () => {
  it("marks the built-in Magazin fallback as an Ersatzstandort, for both causes", () => {
    const unset = describeStartOption("magazin", anchors({ magazin: { coords: [0, 0], source: "unset" } }), t, NOW)
    expect(unset).toMatchObject({ label: "Magazin", caution: true, available: true })
    expect(unset.detail).toBe("Ersatzstandort – Magazin nicht eingerichtet")

    const failed = describeStartOption("magazin", anchors({ magazin: { coords: [0, 0], source: "failed" } }), t, NOW)
    expect(failed.detail).toBe("Ersatzstandort – Einstellungen nicht geladen")
    expect(failed.caution).toBe(true)
  })

  it("names the configured Magazin plainly", () => {
    expect(describeStartOption("magazin", anchors(), t, NOW)).toMatchObject({
      detail: "Standort aus den Einstellungen",
      caution: false,
    })
  })

  it("gives the vehicle fix its clock time, and its age once it is old", () => {
    const fresh = describeStartOption("vehicle", anchors(), t, NOW, "de-CH")
    expect(fresh.detail).toMatch(/^TLF 1 · \d\d:\d\d$/)
    expect(fresh.caution).toBe(false)

    const old = describeStartOption(
      "vehicle",
      anchors({ vehicle: { coords: [0, 0], vehicleName: "TLF 1", reportedAt: new Date(NOW - 75 * 60_000) } }),
      t,
      NOW,
      "de-CH",
    )
    expect(old.detail).toMatch(/^TLF 1 · Stand \d\d:\d\d, vor 1h 15'$/)
    expect(old.caution).toBe(true)
  })

  it("never shows a fix without a timestamp as current", () => {
    const noTime = describeStartOption(
      "vehicle",
      anchors({ vehicle: { coords: [0, 0], vehicleName: "TLF 1", reportedAt: parseReportedAt("garbage") } }),
      t,
      NOW,
    )
    expect(noTime).toMatchObject({ detail: "TLF 1 · Zeitpunkt unbekannt", caution: true })
  })

  it("disables an anchor that is not there, and says why", () => {
    expect(describeStartOption("vehicle", anchors({ vehicle: null }), t, NOW)).toMatchObject({
      available: false,
      detail: "Kein Fahrzeug mit GPS auf diesem Auftrag",
    })
  })
})

describe("used start (after optimising)", () => {
  it("says when it fell back to the first stop", () => {
    const start = resolveRouteStart("magazin", anchors({ magazin: null }))!
    const text = describeRouteStart(start, t, NOW)
    expect(text.caution).toBe(true)
    expect(routeStartSummary(text)).toBe("Erster Stopp · Magazin nicht verfügbar – ab Hauptstrasse 5")
  })

  it("summarises the Magazin fallback in one line", () => {
    const start = resolveRouteStart("magazin", anchors({ magazin: { coords: [0, 0], source: "unset" } }))!
    expect(routeStartSummary(describeRouteStart(start, t, NOW))).toBe(
      "Magazin · Ersatzstandort – Magazin nicht eingerichtet",
    )
  })
})

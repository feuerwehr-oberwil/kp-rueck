/**
 * Route start point — where «Reihenfolge optimieren» measures from, and how the
 * UI says so.
 *
 * The optimisation is a greedy nearest-neighbour by straight-line distance
 * (Luftlinie), not a road route. A confident-looking order invites the reading
 * «the computer worked out the fastest way», so every surface that offers it
 * names the basis («Vorschlag nach Luftlinie · Planungshilfe») and the start
 * point actually used, with its provenance:
 *
 *   - Magazin: from the GPS settings — or, when those are not set up or failed
 *     to load, the built-in fallback position, which must never pass as the
 *     real Magazin.
 *   - Fahrzeug-GPS: the route's vehicle and WHEN it last reported; an old fix
 *     says how old it is, a missing timestamp says «unbekannt».
 *   - Erster Stopp: the current first stop of the route.
 *
 * When the requested anchor is unavailable the optimisation falls back to the
 * first stop — and the resolved start says so instead of quietly pretending.
 *
 * Pure: no React, no i18n runtime — the caller passes a translator.
 */

import { formatDuration } from "@/lib/duration"

export type RouteStartMode = "magazin" | "vehicle" | "first"

/** Where the Magazin coordinates came from. */
export type MagazinSource = "settings" | "unset" | "failed"

export interface MagazinAnchor {
  coords: [number, number]
  source: MagazinSource
}

export interface VehicleAnchor {
  coords: [number, number]
  vehicleName: string
  /** When the tracker reported this position (null = not reported / unparsable). */
  reportedAt: Date | null
}

export interface FirstStopAnchor {
  coords: [number, number]
  /** Display label of the stop (address). */
  label: string
}

export interface RouteStartAnchors {
  magazin: MagazinAnchor | null
  vehicle: VehicleAnchor | null
  firstStop: FirstStopAnchor | null
}

/** The start point an optimisation actually used. */
export type RouteStart =
  | { mode: "magazin"; requested: RouteStartMode; coords: [number, number]; source: MagazinSource }
  | {
      mode: "vehicle"
      requested: RouteStartMode
      coords: [number, number]
      vehicleName: string
      reportedAt: Date | null
    }
  | { mode: "first"; requested: RouteStartMode; coords: [number, number]; label: string }

/** A GPS fix older than this names its age instead of just its clock time. */
export const GPS_STALE_AFTER_MS = 10 * 60_000

/**
 * Resolve the requested start against what is available. Falls back to the
 * first located stop (and records that it did); null when there is no located
 * stop at all.
 */
export function resolveRouteStart(requested: RouteStartMode, anchors: RouteStartAnchors): RouteStart | null {
  if (requested === "magazin" && anchors.magazin) {
    return { mode: "magazin", requested, coords: anchors.magazin.coords, source: anchors.magazin.source }
  }
  if (requested === "vehicle" && anchors.vehicle) {
    return {
      mode: "vehicle",
      requested,
      coords: anchors.vehicle.coords,
      vehicleName: anchors.vehicle.vehicleName,
      reportedAt: anchors.vehicle.reportedAt,
    }
  }
  if (anchors.firstStop) {
    return { mode: "first", requested, coords: anchors.firstStop.coords, label: anchors.firstStop.label }
  }
  return null
}

/** Parse a tracker timestamp; null for missing or garbage. */
export function parseReportedAt(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Translator over the `map.routeOptimize` namespace. Loose on purpose so both
 * next-intl's `useTranslations` result and a test stub fit.
 */
export type RouteStartTranslator = (key: string, values?: Record<string, string | number>) => string

export interface RouteStartText {
  /** «Magazin» / «Fahrzeug-GPS» / «Erster Stopp». */
  label: string
  /** Provenance + time: «Ersatzstandort – Magazin nicht eingerichtet», «TLF · 14:32», the stop address. */
  detail: string
  /** True when the start is a fallback or stale: render it as a caution, not as fact. */
  caution: boolean
}

function clockTime(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
}

function vehicleDetail(
  vehicleName: string,
  reportedAt: Date | null,
  t: RouteStartTranslator,
  now: number,
  locale: string,
): { detail: string; caution: boolean } {
  if (!reportedAt) return { detail: t("vehicleNoTime", { vehicle: vehicleName }), caution: true }
  const age = now - reportedAt.getTime()
  const time = clockTime(reportedAt, locale)
  if (age > GPS_STALE_AFTER_MS) {
    return { detail: t("vehicleStale", { vehicle: vehicleName, time, age: formatDuration(age) }), caution: true }
  }
  return { detail: t("vehicleAt", { vehicle: vehicleName, time }), caution: false }
}

function magazinDetail(source: MagazinSource, t: RouteStartTranslator): { detail: string; caution: boolean } {
  if (source === "settings") return { detail: t("magazinConfigured"), caution: false }
  return { detail: t(source === "failed" ? "magazinFailed" : "magazinUnset"), caution: true }
}

/** Text for one entry of the «Start ab» menu, BEFORE optimising. */
export function describeStartOption(
  mode: RouteStartMode,
  anchors: RouteStartAnchors,
  t: RouteStartTranslator,
  now: number = Date.now(),
  locale = "de-CH",
): RouteStartText & { available: boolean } {
  if (mode === "magazin") {
    if (!anchors.magazin) return { label: t("magazin"), detail: t("magazinLoading"), caution: false, available: false }
    return { label: t("magazin"), ...magazinDetail(anchors.magazin.source, t), available: true }
  }
  if (mode === "vehicle") {
    if (!anchors.vehicle) return { label: t("vehicle"), detail: t("vehicleMissing"), caution: false, available: false }
    const { vehicleName, reportedAt } = anchors.vehicle
    return { label: t("vehicle"), ...vehicleDetail(vehicleName, reportedAt, t, now, locale), available: true }
  }
  if (!anchors.firstStop) return { label: t("first"), detail: t("firstMissing"), caution: false, available: false }
  return { label: t("first"), detail: anchors.firstStop.label, caution: false, available: true }
}

/** Text for the start an optimisation USED (toast + note under the list). */
export function describeRouteStart(
  start: RouteStart,
  t: RouteStartTranslator,
  now: number = Date.now(),
  locale = "de-CH",
): RouteStartText {
  if (start.mode === "magazin") return { label: t("magazin"), ...magazinDetail(start.source, t) }
  if (start.mode === "vehicle") {
    return { label: t("vehicle"), ...vehicleDetail(start.vehicleName, start.reportedAt, t, now, locale) }
  }
  if (start.requested !== "first") {
    // Asked for Magazin / Fahrzeug-GPS, got the first stop: say so.
    return {
      label: t("first"),
      detail: t("fallbackToFirst", { requested: t(start.requested), stop: start.label }),
      caution: true,
    }
  }
  return { label: t("first"), detail: start.label, caution: false }
}

/** One line: «Magazin · Ersatzstandort – Magazin nicht eingerichtet». */
export function routeStartSummary(text: RouteStartText): string {
  return text.detail ? `${text.label} · ${text.detail}` : text.label
}

/**
 * Funkdurchsage builder — the sentence the Einsatzleiter reads over the radio.
 *
 * Two shapes share one set of building blocks so they sound the same:
 *
 * - **Einsatz** (a single incident): «An alle Omega, neuer Einsatz: Poststrasse 6,
 *   es rücken aus … Besonderes: …»
 * - **Auftrag** (a multi-stop route): the first stop that reaches «Disponiert» IS
 *   the Auftragsvergabe and gets the FULL announcement — crew, vehicles, material
 *   and the numbered stop list. Every later stop only gets the short continuation
 *   («… weiter mit Stop 3: Mühlemattstrasse 12»), unless the route picked up
 *   crew/vehicles/material since, which makes it full again. Before this, four
 *   stops meant reading the same crew out four times.
 *
 * The result is a list of segments rather than a string so the dialog can bold the
 * variable parts; `segmentsToText` flattens it for copying and for tests.
 *
 * Deciding full vs. short needs to know what was last announced. That lives on the
 * Auftrag server-side (`lastAnnounced`), not in the browser: two devices, the wall
 * screen, and a reload mid-Einsatz all have to agree.
 */

import type { StopMirrorStatus } from "@/lib/kanban-utils"

/** One piece of the spoken sentence; `bold` marks the variable parts. */
export interface RadioSegment {
  text: string
  bold?: boolean
  /** Start this piece on its own line. The numbered stop list is a list, not a
   *  run-on: «…strasse 31, 3. L…» is unreadable at a glance and worse aloud. */
  newline?: boolean
  /** Screen-only status of this stop. Never spoken and never copied — the radio
   *  hears an address, the operator sees where that stop stands. */
  status?: StopMirrorStatus
}

/** The `useTranslations("kanban")` shape, narrowed to what this module needs. */
export type RadioTranslate = (key: string, values?: Record<string, string | number>) => string

/** A route vehicle, with whether it stays on scene after delivering. */
export interface RadioVehicle {
  name: string
  /** undefined = not tracked for this vehicle, so nothing is said about it. */
  stay?: boolean
}

/** A material item plus its depot/origin, e.g. «Tauchpumpe Gr. (Pio)». */
export interface RadioMaterial {
  name: string
  category?: string | null
}

/** Everything that rides along — the «es rücken aus …» part of the sentence. */
export interface RadioDeployment {
  crew: string[]
  vehicles: RadioVehicle[]
  materials: RadioMaterial[]
  /** «zu Fuss» suppresses the vehicle part entirely. */
  zuFuss: boolean
}

/** One stop of an Auftrag, as it appears in the numbered list. */
export interface RadioStop {
  /** 1-based position in the route. Kept even when earlier stops are done, so
   *  «Stop 3» means the same address for the whole life of the Auftrag. */
  position: number
  address: string
  /** Reko dangers / Nachbarhilfe for this stop, already phrased (or null). */
  special: string | null
  /** Finished stops are left out of the list but keep their number. */
  done: boolean
  /** Where this stop stands, for the screen only (see RadioSegment.status). */
  status?: StopMirrorStatus
}

// ── Building blocks ─────────────────────────────────────────────────────────

/** Spell out the vehicles, including whether each stays on scene or returns. */
export function vehiclePhrase(t: RadioTranslate, vehicles: RadioVehicle[]): string {
  return vehicles
    .map((vehicle) => {
      if (vehicle.stay === undefined) return vehicle.name
      return `${vehicle.name} (${vehicle.stay ? t("disponiert.staysOnSite") : t("disponiert.returns")})`
    })
    .join(", ")
}

/** Spell out the material, including its depot, e.g. «Tauchpumpe Gr. (Pio)». */
export function materialPhrase(materials: RadioMaterial[]): string {
  return materials
    .map((material) => (material.category ? `${material.name} (${material.category})` : material.name))
    .join(", ")
}

/**
 * The «es rücken aus …» clause, WITHOUT any leading separator — the caller
 * supplies it (a comma after an address, a space after the Auftrag's colon).
 * Returns an empty list when nothing is assigned.
 */
export function deploymentSegments(t: RadioTranslate, deployment: RadioDeployment): RadioSegment[] {
  const crew = deployment.crew.length > 0 ? deployment.crew.join(", ") : null
  const vehicles = !deployment.zuFuss && deployment.vehicles.length > 0
    ? vehiclePhrase(t, deployment.vehicles)
    : null
  const materials = deployment.materials.length > 0 ? materialPhrase(deployment.materials) : null

  if (!crew && !vehicles && !materials) return []

  // Material attaches with «und» only after a real vehicle part, «mit» otherwise.
  const materialConnector = vehicles ? t("disponiert.radioAnd") : t("disponiert.radioWith")

  if (crew) {
    const segments: RadioSegment[] = [{ text: t("disponiert.radioDeploySuffix") }, { text: " " }, { text: crew, bold: true }]
    if (deployment.zuFuss) segments.push({ text: " " }, { text: t("disponiert.radioZuFuss"), bold: true })
    if (vehicles) segments.push({ text: ` ${t("disponiert.radioWith")} ` }, { text: vehicles, bold: true })
    if (materials) segments.push({ text: ` ${materialConnector} ` }, { text: materials, bold: true })
    return segments
  }

  if (vehicles) {
    const segments: RadioSegment[] = [{ text: t("disponiert.radioDeploySuffix") }, { text: " " }, { text: vehicles, bold: true }]
    if (materials) segments.push({ text: ` ${t("disponiert.radioWith")} ` }, { text: materials, bold: true })
    return segments
  }

  return [{ text: t("disponiert.radioMaterialOnly") }, { text: " " }, { text: materials as string, bold: true }]
}

/** «Besonderes: …» for one stop — Reko dangers and Nachbarhilfe in one list. */
export function stopSpecial(
  t: RadioTranslate,
  stop: { dangerTypes?: string[]; nachbarhilfe?: boolean; nachbarhilfeNote?: string | null },
): string | null {
  const dangers = stop.dangerTypes && stop.dangerTypes.length > 0 ? stop.dangerTypes.join(", ") : null
  const nachbarhilfe = stop.nachbarhilfe
    ? stop.nachbarhilfeNote
      ? t("disponiert.radioNachbarhilfeWithNote", { note: stop.nachbarhilfeNote })
      : t("disponiert.radioNachbarhilfe")
    : null
  return [dangers, nachbarhilfe].filter(Boolean).join(", ") || null
}

// ── The two announcements ───────────────────────────────────────────────────

/** Announcement for a single incident («neuer Einsatz: …»). */
export function incidentAnnouncement(
  t: RadioTranslate,
  input: { funkrufname: string; address: string; deployment: RadioDeployment; special: string | null },
): RadioSegment[] {
  const segments: RadioSegment[] = [
    { text: t("disponiert.radioIntro", { funkrufname: input.funkrufname }) },
    { text: " " },
    { text: input.address, bold: true },
  ]
  const deployment = deploymentSegments(t, input.deployment)
  if (deployment.length > 0) segments.push({ text: ", " }, ...deployment)
  segments.push({ text: "." })
  if (input.special) {
    segments.push({ text: ` ${t("disponiert.radioSpecial")} ` }, { text: input.special, bold: true }, { text: "." })
  }
  return segments
}

/**
 * Full Auftragsdurchsage — crew first, then the numbered list of the stops that
 * are still open, then everything special collected at the end WITH its address
 * (not inline per stop, so the list of addresses stays readable aloud).
 */
export function auftragFullAnnouncement(
  t: RadioTranslate,
  input: { funkrufname: string; auftragName: string; deployment: RadioDeployment; stops: RadioStop[] },
): RadioSegment[] {
  const open = input.stops.filter((stop) => !stop.done)
  const segments: RadioSegment[] = [
    { text: t("disponiert.radioAuftragIntro", { funkrufname: input.funkrufname, name: input.auftragName }) },
  ]

  const deployment = deploymentSegments(t, input.deployment)
  if (deployment.length > 0) segments.push({ text: " " }, ...deployment, { text: "." })

  // One stop per line. Comma-joined, «Bahnhofstrasse 31, 3. Lettenweg» reads as
  // one address with a house number — exactly the confusion a route cannot
  // afford. Finished stops stay out but the rest keep their numbers, so the gaps
  // in the numbering are real information: 1, 3, 4 means stop 2 is done.
  if (open.length > 0) {
    segments.push({ text: ` ${t("disponiert.radioAuftragStops", { count: open.length })}` })
    for (const stop of open) {
      segments.push({
        text: `${stop.position}. ${stop.address}`,
        bold: true,
        newline: true,
        status: stop.status,
      })
    }
  }

  // Reko dangers + Nachbarhilfe of the open stops, each named with its address.
  const specials = open
    .filter((stop) => stop.special)
    .map((stop) => `${stop.address} ${stop.special}`)
    .join(", ")
  if (specials) {
    segments.push(
      { text: `${t("disponiert.radioSpecial")} `, newline: true },
      { text: specials, bold: true },
      { text: "." },
    )
  }
  return segments
}

/** Short continuation — the route already knows its crew, only the stop is new. */
export function auftragShortAnnouncement(
  t: RadioTranslate,
  input: { funkrufname: string; auftragName: string; stop: RadioStop },
): RadioSegment[] {
  const segments: RadioSegment[] = [
    {
      text: t("disponiert.radioAuftragContinue", {
        funkrufname: input.funkrufname,
        name: input.auftragName,
        pos: input.stop.position,
      }),
    },
    { text: " " },
    { text: input.stop.address, bold: true },
    { text: "." },
  ]
  // A Gefahr never gets dropped just because the announcement is the short one.
  if (input.stop.special) {
    segments.push({ text: ` ${t("disponiert.radioSpecial")} ` }, { text: input.stop.special, bold: true }, { text: "." })
  }
  return segments
}

// ── Full-vs-short decision + the fingerprint it rests on ────────────────────

/**
 * Digest of everything the announcement names — compared for equality only,
 * never parsed. Sorted, so the order the assignments came back in cannot flip
 * the result, and built from the raw names/ids rather than the spoken phrase so
 * it does not move when the interface language does.
 */
export function radioFingerprint(deployment: { crew: string[]; vehicles: RadioVehicle[]; materials: RadioMaterial[] }): string {
  const part = (prefix: string, values: string[]) => `${prefix}:${[...values].sort().join(",")}`
  return [
    part("p", deployment.crew),
    part("v", deployment.vehicles.map((vehicle) => vehicle.name)),
    part("m", deployment.materials.map((material) => material.name)),
  ].join("|")
}

/**
 * Is the full announcement due? Yes for the very first one, and again whenever
 * the route's resources differ from what was announced last — the crew on the
 * radio has changed, so «weiter mit Stop 3» would leave someone unaccounted for.
 */
export function needsFullAnnouncement(
  lastAnnounced: { fingerprint: string } | null,
  currentFingerprint: string,
): boolean {
  if (!lastAnnounced) return true
  return lastAnnounced.fingerprint !== currentFingerprint
}

/** Flatten segments to plain text (copying, printing, tests). A segment marked
 *  `newline` starts a line, so a copied Auftrag pastes as the same list that is
 *  on screen. The screen-only status is never part of it. */
export function segmentsToText(segments: RadioSegment[]): string {
  return segments
    .map((segment, index) => (segment.newline && index > 0 ? `\n${segment.text}` : segment.text))
    .join("")
}

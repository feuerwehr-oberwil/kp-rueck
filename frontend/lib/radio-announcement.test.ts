import { describe, expect, it } from "vitest"
import { createTranslator } from "next-intl"
import de from "@/messages/de.json"
import {
  auftragFullAnnouncement,
  auftragShortAnnouncement,
  incidentAnnouncement,
  needsFullAnnouncement,
  radioFingerprint,
  segmentsToText,
  stopSpecial,
  type RadioDeployment,
  type RadioStop,
} from "./radio-announcement"

// The real German catalogue, not a stub: these tests pin the sentence the
// Einsatzleiter actually reads out, so a well-meaning edit to de.json that
// breaks the wording fails here rather than on the radio.
const t = createTranslator({ locale: "de", messages: de, namespace: "kanban" }) as unknown as (
  key: string,
  values?: Record<string, string | number>,
) => string

const deployment = (overrides: Partial<RadioDeployment> = {}): RadioDeployment => ({
  crew: ["Weber Martin", "Baumann Michael"],
  vehicles: [{ name: "Pio" }],
  materials: [{ name: "Motorsäge Gr." }],
  zuFuss: false,
  ...overrides,
})

const stop = (overrides: Partial<RadioStop> = {}): RadioStop => ({
  position: 1,
  address: "Poststrasse 6",
  special: null,
  done: false,
  ...overrides,
})

describe("incident announcement", () => {
  it("names the address, then the crew, vehicles and material", () => {
    const text = segmentsToText(
      incidentAnnouncement(t, {
        funkrufname: "Omega",
        address: "Poststrasse 6",
        deployment: deployment(),
        special: null,
      }),
    )
    expect(text).toBe(
      "An alle Omega, neuer Einsatz: Poststrasse 6, es rücken aus Weber Martin, Baumann Michael mit Pio und Motorsäge Gr..",
    )
  })

  it("ends after the address when nothing is assigned yet", () => {
    const text = segmentsToText(
      incidentAnnouncement(t, {
        funkrufname: "Omega",
        address: "Poststrasse 6",
        deployment: deployment({ crew: [], vehicles: [], materials: [] }),
        special: null,
      }),
    )
    expect(text).toBe("An alle Omega, neuer Einsatz: Poststrasse 6.")
  })

  it("says «zu Fuss» instead of a vehicle", () => {
    const text = segmentsToText(
      incidentAnnouncement(t, {
        funkrufname: "Omega",
        address: "Poststrasse 6",
        deployment: deployment({ zuFuss: true, materials: [] }),
        special: null,
      }),
    )
    expect(text).toContain("es rücken aus Weber Martin, Baumann Michael zu Fuss.")
  })

  it("appends Besonderes when there is something to warn about", () => {
    const text = segmentsToText(
      incidentAnnouncement(t, {
        funkrufname: "Omega",
        address: "Poststrasse 6",
        deployment: deployment({ crew: [], vehicles: [], materials: [] }),
        special: "Gasflaschen",
      }),
    )
    expect(text).toBe("An alle Omega, neuer Einsatz: Poststrasse 6. Besonderes: Gasflaschen.")
  })
})

describe("Auftrag — full announcement", () => {
  it("reads the crew once, then the numbered stops", () => {
    const text = segmentsToText(
      auftragFullAnnouncement(t, {
        funkrufname: "Omega",
        auftragName: "Sturmholz Oberwil",
        deployment: deployment({ crew: ["Weber Martin", "Moser Lea"] }),
        stops: [
          stop({ position: 1, address: "Poststrasse 6" }),
          stop({ position: 2, address: "Schulstrasse 9" }),
        ],
      }),
    )
    expect(text).toBe(
      "An alle Omega, neuer Auftrag «Sturmholz Oberwil»: es rücken aus Weber Martin, Moser Lea mit Pio und Motorsäge Gr.. " +
        "2 Stops:\n1. Poststrasse 6\n2. Schulstrasse 9",
    )
  })

  it("leaves finished stops out but keeps the numbers of the rest", () => {
    const text = segmentsToText(
      auftragFullAnnouncement(t, {
        funkrufname: "Omega",
        auftragName: "Sturmholz Oberwil",
        deployment: deployment({ crew: [], vehicles: [], materials: [] }),
        stops: [
          stop({ position: 1, address: "Poststrasse 6", done: true }),
          stop({ position: 2, address: "Schulstrasse 9" }),
          stop({ position: 3, address: "Mühlemattstrasse 12" }),
        ],
      }),
    )
    // Stop 1 is done and gone, but 2 and 3 keep the numbers they always had.
    expect(text).toBe(
      "An alle Omega, neuer Auftrag «Sturmholz Oberwil»: 2 Stops:\n2. Schulstrasse 9\n3. Mühlemattstrasse 12",
    )
  })

  it("collects Besonderes at the end, each with its address", () => {
    const text = segmentsToText(
      auftragFullAnnouncement(t, {
        funkrufname: "Omega",
        auftragName: "Sturmholz Oberwil",
        deployment: deployment({ crew: [], vehicles: [], materials: [] }),
        stops: [
          stop({ position: 1, address: "Poststrasse 6", special: "Gasflaschen" }),
          stop({ position: 2, address: "Schulstrasse 9" }),
          stop({ position: 3, address: "Mühlemattstrasse 12", special: "Nachbarhilfe" }),
        ],
      }),
    )
    expect(text).toContain("Besonderes: Poststrasse 6 Gasflaschen, Mühlemattstrasse 12 Nachbarhilfe.")
  })

  it("uses the singular for a one-stop Auftrag", () => {
    const text = segmentsToText(
      auftragFullAnnouncement(t, {
        funkrufname: "Omega",
        auftragName: "Keller",
        deployment: deployment({ crew: [], vehicles: [], materials: [] }),
        stops: [stop()],
      }),
    )
    expect(text).toContain("1 Stop:\n1. Poststrasse 6")
  })
})

describe("Auftrag — the stop list is a list", () => {
  const threeStops = () =>
    auftragFullAnnouncement(t, {
      funkrufname: "Omega",
      auftragName: "Sturmholz Oberwil",
      deployment: deployment({ crew: [], vehicles: [], materials: [] }),
      stops: [
        stop({ position: 1, address: "Bahnhofstrasse 31", status: "active" }),
        stop({ position: 2, address: "Lettenweg 4", done: true, status: "complete" }),
        stop({ position: 3, address: "Schulstrasse 9", status: "incoming" }),
      ],
    })

  it("puts every open stop on its own line", () => {
    const stopLines = threeStops().filter((segment) => segment.newline && segment.status)
    expect(stopLines.map((segment) => segment.text)).toEqual([
      "1. Bahnhofstrasse 31",
      "3. Schulstrasse 9",
    ])
    // Run together with commas this read as one address with a house number.
    expect(segmentsToText(threeStops())).toContain("\n1. Bahnhofstrasse 31\n3. Schulstrasse 9")
  })

  it("carries each open stop's status for the screen, never for the radio", () => {
    const stopLines = threeStops().filter((segment) => segment.newline && segment.status)
    expect(stopLines.map((segment) => segment.status)).toEqual(["active", "incoming"])

    // The spoken and copied text is addresses only — nobody reads a status code
    // over the radio, and the finished stop is not in there at all.
    const text = segmentsToText(threeStops())
    for (const forbidden of ["active", "incoming", "Einsatz", "Offen", "Lettenweg"]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it("starts Besonderes on its own line, below the stops", () => {
    const segments = auftragFullAnnouncement(t, {
      funkrufname: "Omega",
      auftragName: "Sturmholz Oberwil",
      deployment: deployment({ crew: [], vehicles: [], materials: [] }),
      stops: [stop({ position: 1, address: "Poststrasse 6", special: "Gasflaschen" })],
    })
    expect(segmentsToText(segments)).toContain("\n1. Poststrasse 6\nBesonderes: Poststrasse 6 Gasflaschen.")
  })
})

describe("Auftrag — short continuation", () => {
  it("names only the Auftrag and the stop", () => {
    const text = segmentsToText(
      auftragShortAnnouncement(t, {
        funkrufname: "Omega",
        auftragName: "Sturmholz Oberwil",
        stop: stop({ position: 3, address: "Mühlemattstrasse 12" }),
      }),
    )
    expect(text).toBe("An alle Omega, Auftrag «Sturmholz Oberwil» weiter mit Stop 3: Mühlemattstrasse 12.")
  })

  it("still warns — a Gefahr is never dropped for brevity", () => {
    const text = segmentsToText(
      auftragShortAnnouncement(t, {
        funkrufname: "Omega",
        auftragName: "Sturmholz Oberwil",
        stop: stop({ position: 3, address: "Mühlemattstrasse 12", special: "Gasflaschen" }),
      }),
    )
    expect(text).toContain("Besonderes: Gasflaschen.")
  })
})

describe("full-vs-short decision", () => {
  it("is full when nothing was ever announced", () => {
    expect(needsFullAnnouncement(null, "p:a|v:|m:")).toBe(true)
  })

  it("is short while the resources are unchanged", () => {
    expect(needsFullAnnouncement({ fingerprint: "p:a|v:|m:" }, "p:a|v:|m:")).toBe(false)
  })

  it("is full again once the route gained a resource", () => {
    expect(needsFullAnnouncement({ fingerprint: "p:a|v:|m:" }, "p:a,b|v:|m:")).toBe(true)
  })

  it("does not move when the assignment order does", () => {
    const one = radioFingerprint({ crew: ["Weber", "Moser"], vehicles: [{ name: "Pio" }], materials: [] })
    const other = radioFingerprint({ crew: ["Moser", "Weber"], vehicles: [{ name: "Pio" }], materials: [] })
    expect(one).toBe(other)
  })

  it("ignores whether the driver stays on site — that is not a new resource", () => {
    const stays = radioFingerprint({ crew: [], vehicles: [{ name: "Pio", stay: true }], materials: [] })
    const returns = radioFingerprint({ crew: [], vehicles: [{ name: "Pio", stay: false }], materials: [] })
    expect(stays).toBe(returns)
  })
})

describe("stopSpecial", () => {
  it("joins Reko dangers and Nachbarhilfe into one list", () => {
    expect(stopSpecial(t, { dangerTypes: ["Gasflaschen"], nachbarhilfe: true, nachbarhilfeNote: "Therwil" }))
      .toBe("Gasflaschen, Nachbarhilfe (Therwil)")
  })

  it("is null when there is nothing special", () => {
    expect(stopSpecial(t, { dangerTypes: [], nachbarhilfe: false })).toBeNull()
  })
})

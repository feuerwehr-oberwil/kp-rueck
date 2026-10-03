import { describe, expect, it } from "vitest"
import { formatWhatsAppMessage } from "./whatsapp-formatter"
import type { Operation } from "@/lib/contexts/operations-context"

const operation = {
  id: "e1",
  location: "Hauptstrasse 5",
  incidentType: "elementarereignis",
  notes: "",
  contact: "",
  internalNotes: "",
  crew: [],
  materials: [],
  vehicles: ["TLF"],
  vehicleCallsigns: new Map(),
  vehicleDriverStay: new Map(),
  zuFuss: false,
  leaderName: null,
} as unknown as Operation

const routeResources = {
  personnel: [],
  materials: [],
  vehicles: [{ assignmentId: "a1", resourceId: "v2", name: "Pio" }],
}

describe("formatWhatsAppMessage — vehicles without a driver", () => {
  it("says «ohne Fahrer» for Einsatz and Auftrag vehicles alike when the driver map is known", () => {
    const message = formatWhatsAppMessage({
      operation,
      materials: [],
      vehicleDrivers: new Map([["TLF", "Meier"]]),
      groupResources: routeResources,
      template: "{vehicles}",
    })
    expect(message).toContain("TLF (Fahrer: Meier)")
    expect(message).toContain("Pio (⚠ ohne Fahrer)")
  })

  it("claims nothing without a driver map", () => {
    const message = formatWhatsAppMessage({ operation, materials: [], template: "{vehicles}" })
    expect(message).not.toContain("ohne Fahrer")
  })
})

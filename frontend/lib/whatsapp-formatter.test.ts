import { describe, expect, it } from "vitest"
import { formatWhatsAppMessage } from "./whatsapp-formatter"
import { assignedVehicle, makeOperation } from "@/test-utils/operation-fixtures"

const operation = makeOperation({
  id: "e1",
  location: "Hauptstrasse 5",
  vehicles: [assignedVehicle("TLF")],
})

const routeResources = {
  personnel: [],
  materials: [],
  vehicles: [{ assignmentId: "a1", resourceId: "v2", name: "Pio" }],
}

describe("formatWhatsAppMessage — vehicles without a driver", () => {
  it("says «ohne Fahrer» for Einsatz and Auftrag vehicles alike when the driver map is known", () => {
    const message = formatWhatsAppMessage({
      operation: { ...operation, auftragResources: routeResources },
      materials: [],
      vehicleDrivers: new Map([["v-TLF", { name: "Meier", personnelId: "p-meier" }]]),
      template: "{vehicles}",
    })
    expect(message).toContain("TLF (Fahrer: Meier)")
    expect(message).toContain("Pio (⚠ ohne Fahrer)")
  })

  it("claims nothing without a driver map", () => {
    const message = formatWhatsAppMessage({ operation, materials: [], template: "{vehicles}" })
    expect(message).not.toContain("ohne Fahrer")
  })

  it("names a namesake driver with the Kennung, as the crew line does", () => {
    const message = formatWhatsAppMessage({
      operation,
      materials: [],
      vehicleDrivers: new Map([["v-TLF", { name: "Meier", personnelId: "p-meier" }]]),
      template: "{vehicles}",
      personText: (person) => (person.personnelId === "p-meier" ? `${person.name} (1985)` : person.name),
    })
    expect(message).toContain("TLF (Fahrer: Meier (1985))")
  })

  it("names an Auftrag vehicle with its call sign", () => {
    const message = formatWhatsAppMessage({
      operation: {
        ...operation,
        vehicles: [],
        auftragResources: { ...routeResources, vehicles: [{ assignmentId: "a1", resourceId: "v2", name: "Pio", callsign: "Omega 3" }] },
      },
      materials: [],
      template: "{vehicles}",
    })
    expect(message).toContain("Pio · Omega 3")
  })
})

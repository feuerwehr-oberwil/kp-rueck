import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import { assignedVehicle } from "@/test-utils/operation-fixtures"
import type { Operation } from "@/lib/contexts/operations-context"
import { OperationHoverCard } from "./operation-hover-card"

const operation = (overrides: Partial<Operation>) =>
  ({
    id: "i1", number: 7, location: "Hauptstrasse 1", incidentType: "brandbekaempfung", status: "active",
    priority: "high", dispatchTime: new Date("2026-11-19T09:00:00Z"), statusChangedAt: null,
    crew: [], vehicles: [], materials: [], notes: "", assignedReko: null, leaderId: null, pickupNeeded: false,
    ...overrides,
  }) as Operation

describe("map hover card", () => {
  it("says per vehicle whether its driver stays on site or returns", () => {
    renderWithIntl(
      <OperationHoverCard
        operation={operation({
          vehicles: [
            assignedVehicle("TLF", { callsign: "Omega 1", driverStay: true }),
            assignedVehicle("Pio", { driverStay: false }),
            // Assign POST not answered yet: nothing said about the driver.
            assignedVehicle("MTW"),
          ],
        })}
        routeName="Nord"
        routeResources={{
          personnel: [],
          materials: [],
          vehicles: [{ assignmentId: "a9", resourceId: "v9", name: "Mowa", driverStay: true }],
        }}
      />,
    )

    // The Einsatz's own vehicles, then the Auftrag's under its name.
    const [einsatz, route] = screen.getAllByText("Fahrzeuge:", { exact: false, selector: "p > span" })
    expect(einsatz.parentElement?.textContent).toBe("Fahrzeuge: TLF · Omega 1 · bleibt vor Ort, Pio · kehrt zurück, MTW")
    expect(route.parentElement?.textContent).toBe("Fahrzeuge: Mowa · bleibt vor Ort")
  })
})

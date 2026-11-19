/**
 * The footer «Fahrzeuge» sheet: one request for the whole fleet, the last data
 * shown at once on the next opening, and every Einsatz/Auftrag a vehicle serves.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { ApiVehicleStatus } from "@/lib/api-client"

const api = vi.hoisted(() => ({
  getVehicleStatuses: vi.fn(),
  getEventSpecialFunctions: vi.fn(async () => []),
}))
const push = vi.hoisted(() => vi.fn())
const routes = vi.hoisted(() => ({
  groups: [] as { id: string; name: string; color: string | null; stopIds: string[]; assignments: { resourceType: string; resourceId: string }[] }[],
}))
vi.mock("@/lib/api-client", () => ({ apiClient: api }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ personnel: [], operations: [], removeCrew: vi.fn() }),
}))
vi.mock("@/lib/contexts/groups-context", () => ({ useGroups: () => routes }))
vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("./driver-assignment-dialog", () => ({ DriverAssignmentDialog: () => null }))

import { VehicleStatusSheet } from "./vehicle-status-sheet"

function vehicle(overrides: Partial<ApiVehicleStatus> = {}): ApiVehicleStatus {
  return {
    id: "v1", name: "TLF", type: "TLF", status: "available", out_of_service: false, out_of_service_since: null,
    radio_call_sign: "Omega 1", driver_id: null, driver_name: null, driver_assigned_at: null, deployments: [],
    ...overrides,
  }
}

function deployment(incidentId: string, label: string, minutes: number) {
  return {
    incident_id: incidentId, title: label, location_address: label, location_display: label,
    status: "active", assigned_at: "2026-11-19T09:00:00Z", duration_minutes: minutes,
  }
}

beforeEach(() => {
  api.getVehicleStatuses.mockReset()
  push.mockReset()
  routes.groups = []
})

describe("VehicleStatusSheet", () => {
  it("loads the fleet in one request and opens on the last data without a loading line", async () => {
    api.getVehicleStatuses.mockResolvedValue([vehicle()])
    const first = renderWithIntl(<VehicleStatusSheet open onOpenChange={() => {}} eventId="e-cache" />)
    expect(screen.getByText("Fahrzeuge werden geladen …")).toBeInTheDocument()
    expect(await screen.findByText("TLF")).toBeInTheDocument()
    expect(api.getVehicleStatuses).toHaveBeenCalledTimes(1)
    expect(api.getVehicleStatuses).toHaveBeenCalledWith("e-cache")
    first.unmount()

    // Reopened (a fresh mount): the TLF is there before the refresh answers.
    api.getVehicleStatuses.mockReturnValue(new Promise(() => {}))
    renderWithIntl(<VehicleStatusSheet open onOpenChange={() => {}} eventId="e-cache" />)
    expect(screen.getByText("TLF")).toBeInTheDocument()
    expect(screen.queryByText("Fahrzeuge werden geladen …")).not.toBeInTheDocument()
    await waitFor(() => expect(api.getVehicleStatuses).toHaveBeenCalledTimes(2))
  })

  it("lists every Auftrag and Einsatz a vehicle serves, each opening its own card", async () => {
    routes.groups = [{
      id: "g1", name: "Nord", color: null, stopIds: ["stop-1"],
      assignments: [{ resourceType: "vehicle", resourceId: "v1" }],
    }]
    api.getVehicleStatuses.mockResolvedValue([vehicle({
      deployments: [
        deployment("i-old", "Hauptstrasse 1", 40),
        deployment("i-new", "Blumenweg 21", 5),
        // A stop of its own Auftrag: «Auftrag «Nord»» already stands for it.
        deployment("stop-1", "Stoppweg 3", 20),
      ],
    })])
    renderWithIntl(<VehicleStatusSheet open onOpenChange={() => {}} eventId="e-multi" />)

    const links = await screen.findAllByRole("button", { name: /Auftrag «Nord»|Hauptstrasse 1|Blumenweg 21|Stoppweg 3/ })
    expect(links.map((link) => link.textContent)).toEqual(["Auftrag «Nord»", "Hauptstrasse 1", "Blumenweg 21"])
    // The clock follows the oldest Einsatz.
    expect(screen.getByText("40'")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /Blumenweg 21/ }))
    expect(push).toHaveBeenCalledWith("/?highlight=i-new")
    await userEvent.click(screen.getByRole("button", { name: "Auftrag «Nord»" }))
    expect(push).toHaveBeenLastCalledWith("/?highlight=stop-1")
  })
})

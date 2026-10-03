/**
 * The driver prompt now also follows a vehicle put on an AUFTRAG: dismissing it
 * asks — like the Einsatz path — whether the vehicle comes back off the route.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"

const ops = vi.hoisted(() => ({
  vehicleNeedingDriver: null as null | { vehicleId: string; vehicleName: string; groupId?: string; incidentId?: string },
  clearVehicleNeedingDriver: vi.fn(),
  personnel: [],
  operations: [],
  removeCrew: vi.fn(),
  removeVehicle: vi.fn(),
  formatLocation: (s: string) => s,
}))
const routes = vi.hoisted(() => ({
  groups: [{ id: "g1", name: "Route West", assignments: [{ id: "ga1", resourceType: "vehicle", resourceId: "v1" }] }],
  unassignResource: vi.fn(async () => true),
}))
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => ops }))
vi.mock("@/lib/contexts/groups-context", () => ({ useGroups: () => routes }))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: { id: "e1" } }) }))
vi.mock("@/lib/api-client", () => ({ apiClient: { getEventSpecialFunctions: async () => [] } }))
vi.mock("./driver-assignment-dialog", () => ({
  DriverAssignmentDialog: ({ onOpenChange, vehicleName }: { onOpenChange: (o: boolean) => void; vehicleName: string }) => (
    <button onClick={() => onOpenChange(false)}>close picker for {vehicleName}</button>
  ),
}))

import { VehicleDriverPrompt } from "./vehicle-driver-prompt"

function renderPrompt() {
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <VehicleDriverPrompt />
    </NextIntlClientProvider>,
  )
}

beforeEach(() => {
  routes.unassignResource.mockClear()
  ops.clearVehicleNeedingDriver.mockClear()
})

describe("VehicleDriverPrompt on an Auftrag", () => {
  it("dismissing asks whether the vehicle comes off the Auftrag, and «entfernen» releases it there", async () => {
    ops.vehicleNeedingDriver = { vehicleId: "v1", vehicleName: "TLF", groupId: "g1" }
    const view = renderPrompt()
    await userEvent.click(screen.getByText("close picker for TLF"))
    ops.vehicleNeedingDriver = null
    view.rerender(
      <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
        <VehicleDriverPrompt />
      </NextIntlClientProvider>,
    )
    expect(await screen.findByText(/ist dem Auftrag «Route West» zugewiesen, aber niemand fährt/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Fahrzeug entfernen" }))
    expect(routes.unassignResource).toHaveBeenCalledWith("g1", "ga1")
  })

  it("opened from «Fahrer wählen» (no target), closing asks nothing back", async () => {
    ops.vehicleNeedingDriver = { vehicleId: "v1", vehicleName: "TLF" }
    renderPrompt()
    await userEvent.click(screen.getByText("close picker for TLF"))
    expect(ops.clearVehicleNeedingDriver).toHaveBeenCalled()
    expect(screen.queryByText(/aber niemand fährt/)).not.toBeInTheDocument()
  })
})

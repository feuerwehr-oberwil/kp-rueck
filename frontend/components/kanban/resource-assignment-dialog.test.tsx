import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"

import type { Material } from "@/lib/contexts/materials-context"
import type { Person } from "@/lib/contexts/operations-context"

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ operations: [] }),
}))

vi.mock("@/lib/contexts/materials-context", () => ({
  useMaterials: () => ({ materialGroups: [] }),
}))

vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({
    groups: [],
    getGroupResources: () => ({ vehicles: [], personnel: [], materials: [] }),
  }),
}))

// The dialog names each vehicle's driver, which needs the event scope and a
// live fetch. Neither is what these tests are about.
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock("@/lib/hooks/use-vehicle-drivers", () => ({ useVehicleDrivers: () => new Map() }))

import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"

const material = (overrides: Partial<Material> = {}): Material => ({
  id: "mat-1",
  name: "Tauchpumpe Gr.",
  category: "Magazin",
  type: "Tauchpumpen",
  status: "assigned",
  categorySortOrder: 0,
  consumable: false,
  groupId: null,
  ...overrides,
})

const PUMP = material()
const TAPE = material({
  id: "mat-2",
  name: "Triopan / Absperrband",
  type: "Verbrauchsmaterial",
  status: "available",
  consumable: true,
})

function renderDialog() {
  return renderWithIntl(
    <ResourceAssignmentDialog
      open
      onOpenChange={vi.fn()}
      resourceType="materials"
      operationId="incident-1"
      personnel={[]}
      vehicles={[]}
      materials={[PUMP, TAPE]}
      assignedPersonnel={[]}
      assignedVehicles={[]}
      assignedMaterials={[]}
      onAssignPerson={vi.fn()}
      onAssignVehicle={vi.fn()}
      onAssignMaterial={vi.fn()}
      onRemovePerson={vi.fn()}
      onRemoveVehicle={vi.fn()}
      onRemoveMaterial={vi.fn()}
      // Both items sit on ANOTHER incident already.
      occupiedMaterialIds={new Set([PUMP.id, TAPE.id])}
    />,
  )
}

describe("material double-booking guard", () => {
  it("asks before a limited material is taken off another incident", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("button", { name: /Tauchpumpe Gr\./ }))

    expect(await screen.findByText("Doppelbelegung?")).toBeDefined()
  })

  it("selects Verbrauchsmaterial straight away – unlimited stock is never double-booked", async () => {
    const user = userEvent.setup()
    renderDialog()

    // No «Im Einsatz» flag: being on another incident says nothing about this one.
    const tape = screen.getByRole("button", { name: /Triopan \/ Absperrband/ })
    expect(tape.textContent).not.toContain("Im Einsatz")

    await user.click(tape)

    // Ticked immediately – the confirm never opens.
    await waitFor(() => expect(screen.getByText("Änderungen")).toBeDefined())
    expect(screen.queryByText("Doppelbelegung?")).toBeNull()
  })
})

describe("special functions in the crew list", () => {
  const person = (over: Partial<Person> & { name: string }): Person =>
    ({ id: over.name, role: "Soldat", status: "available", ...over }) as Person

  function renderCrew(personnel: Person[]) {
    return renderWithIntl(
      <ResourceAssignmentDialog
        open
        onOpenChange={vi.fn()}
        resourceType="crew"
        operationId="incident-1"
        personnel={personnel}
        vehicles={[]}
        materials={[]}
        assignedPersonnel={[]}
        assignedVehicles={[]}
        assignedMaterials={[]}
        onAssignPerson={vi.fn()}
        onAssignVehicle={vi.fn()}
        onAssignMaterial={vi.fn()}
        onRemovePerson={vi.fn()}
        onRemoveVehicle={vi.fn()}
        onRemoveMaterial={vi.fn()}
      />,
    )
  }

  it("shows the function, never a generic «Im Einsatz», for a special-function person", () => {
    // The context marks special-function people `status: "assigned"` although
    // they are on no incident — the tile must not read that as «Im Einsatz»
    // (Image #16: «Im Einsatz» + «TLF» on a driver who was sitting in the KP).
    renderCrew([person({ name: "Egger Olivier", status: "assigned", isTelefondienst: true })])

    const tile = screen.getByRole("button", { name: /Egger Olivier/ })
    expect(tile.textContent).toContain("Telefondienst")
    expect(tile.textContent).not.toContain("Im Einsatz")
  })

  it("finds a person by their special function in the search", async () => {
    const user = userEvent.setup()
    renderCrew([
      person({ name: "Egger Olivier", isKommandoposten: true }),
      person({ name: "Frei Anna" }),
    ])

    await user.type(screen.getByPlaceholderText("Suchen..."), "kommandoposten")

    expect(screen.getByRole("button", { name: /Egger Olivier/ })).toBeDefined()
    expect(screen.queryByRole("button", { name: /Frei Anna/ })).toBeNull()
  })
})

describe("vor Ort / zurück in the vehicle assignment", () => {
  const TLF = { id: "v1", name: "TLF", type: "Tanklöschfahrzeug" }
  const PIO = { id: "v2", name: "Pio", type: "Pionier" }

  function renderVehicles(onToggleDriverStay?: (name: string) => void) {
    return renderWithIntl(
      <ResourceAssignmentDialog
        open
        onOpenChange={vi.fn()}
        resourceType="vehicles"
        operationId="incident-1"
        personnel={[]}
        vehicles={[TLF, PIO]}
        materials={[]}
        assignedPersonnel={[]}
        assignedVehicles={["TLF"]}
        assignedMaterials={[]}
        onAssignPerson={vi.fn()}
        onAssignVehicle={vi.fn()}
        onAssignMaterial={vi.fn()}
        onRemovePerson={vi.fn()}
        onRemoveVehicle={vi.fn()}
        onRemoveMaterial={vi.fn()}
        vehicleDriverStay={new Map([["TLF", false]])}
        onToggleDriverStay={onToggleDriverStay}
      />,
    )
  }

  it("offers the toggle on an assigned vehicle and reports its state", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    renderVehicles(onToggle)

    // «zurück» is the default the flag carries from the moment of assignment.
    const toggle = screen.getByRole("button", { name: /zurück/ })
    expect(toggle.getAttribute("aria-pressed")).toBe("false")

    await user.click(toggle)
    expect(onToggle).toHaveBeenCalledWith("TLF")
  })

  it("does not offer it on a vehicle that is not assigned here", () => {
    renderVehicles(vi.fn())

    // Exactly one toggle — the unassigned Pio has nothing to set it on.
    expect(screen.queryAllByRole("button", { name: /zurück|bleibt/ })).toHaveLength(1)
  })

  it("stays out of the way when the target cannot carry the flag (an Auftrag)", () => {
    renderVehicles(undefined)
    expect(screen.queryByRole("button", { name: /zurück|bleibt/ })).toBeNull()
  })
})

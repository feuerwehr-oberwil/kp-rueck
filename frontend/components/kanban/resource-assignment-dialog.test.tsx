import { describe, expect, it, vi, type Mock } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"

import type { Material } from "@/lib/contexts/materials-context"
import type { Person } from "@/lib/contexts/operations-context"

// Mutable so a test can flag a vehicle «Nicht einsatzbereit» — the dialog
// resolves readiness from this context itself, not from a caller prop.
const operationsState = vi.hoisted(() => ({
  operations: [] as unknown[],
  outOfServiceVehicleIds: new Set<string>(),
  requestResourceConflict: vi.fn(),
  removeMaterial: vi.fn(async () => true),
  removeCrew: vi.fn(async () => true),
}))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => operationsState,
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
  outOfService: false,
  outOfServiceSince: null,
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
      assignedPersonnelIds={[]}
      assignedVehicleIds={[]}
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

    const confirm = await screen.findByRole("alertdialog", { name: /ist schon zugewiesen/ })
    // A double booking is chosen by hand: Enter stays on Abbrechen (owner pick #3, 23.11.2026).
    expect(within(confirm).getByRole("button", { name: "Abbrechen" })).toHaveFocus()
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
    expect(screen.queryByText(/ist schon zugewiesen/)).toBeNull()
  })

  it("clears the «just assigned» flash timer when the dialog unmounts", () => {
    const setSpy = vi.spyOn(globalThis, "setTimeout")
    const clearSpy = vi.spyOn(globalThis, "clearTimeout")
    const { unmount } = renderDialog()

    fireEvent.click(screen.getByRole("button", { name: /Triopan \/ Absperrband/ }))
    const flashTimer = setSpy.mock.results[setSpy.mock.calls.findIndex(([, ms]) => ms === 600)]?.value
    expect(flashTimer).toBeDefined()

    unmount()
    expect(clearSpy).toHaveBeenCalledWith(flashTimer)
  })
})

describe("«Hierher verschieben» from the assignment dialog", () => {
  // The pump stands on Einsatz 11; the dialog assigns to incident-1.
  const holder = {
    id: "incident-2", number: 11, location: "Bahnhofstrasse 12", incidentType: "", vehicles: [], crew: [],
    materials: [PUMP.id], materialAssignments: new Map([[PUMP.id, "asg-pump"]]),
  }

  /** Ticks the pump and answers «Hierher verschieben». `beforeMove` runs between the two. */
  async function moveThePump(
    onAssignMaterial: Mock<(materialId: string, operationId: string) => void>,
    beforeMove?: () => void,
  ) {
    operationsState.operations = [holder]
    operationsState.requestResourceConflict.mockClear()
    operationsState.removeMaterial.mockClear()
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const view = renderWithIntl(
      <ResourceAssignmentDialog
        open
        onOpenChange={onOpenChange}
        resourceType="materials"
        operationId="incident-1"
        personnel={[]}
        vehicles={[]}
        materials={[PUMP]}
        assignedPersonnelIds={[]}
        assignedVehicleIds={[]}
        assignedMaterials={[]}
        onAssignPerson={vi.fn()}
        onAssignVehicle={vi.fn()}
        onAssignMaterial={onAssignMaterial}
        onRemovePerson={vi.fn()}
        onRemoveVehicle={vi.fn()}
        onRemoveMaterial={vi.fn()}
      />,
    )
    await user.click(screen.getByRole("button", { name: /Tauchpumpe Gr\./ }))
    const [[conflict]] = operationsState.requestResourceConflict.mock.calls
    beforeMove?.()
    await conflict.customResolve("move")
    return { user, view, onOpenChange }
  }

  it("frees the holder only together with the assign, at «Fertig»", async () => {
    const onAssignMaterial = vi.fn<(materialId: string, operationId: string) => void>()
    const { user } = await moveThePump(onAssignMaterial)
    // Staged like the tick: nothing has left Einsatz 11 yet.
    expect(operationsState.removeMaterial).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Fertig" }))
    await waitFor(() => expect(onAssignMaterial).toHaveBeenCalledWith(PUMP.id, "incident-1"))
    expect(operationsState.removeMaterial).toHaveBeenCalledExactlyOnceWith("incident-2", PUMP.id)
    expect(operationsState.removeMaterial.mock.invocationCallOrder[0]).toBeLessThan(onAssignMaterial.mock.invocationCallOrder[0])
    operationsState.operations = []
  })

  // Sol review E round 2, S3: a failed release used to assign anyway – a double booking.
  it("skips the assign and stays open when freeing the holder fails", async () => {
    const onAssignMaterial = vi.fn<(materialId: string, operationId: string) => void>()
    const { user, onOpenChange } = await moveThePump(onAssignMaterial)
    operationsState.removeMaterial.mockResolvedValueOnce(false)

    await user.click(screen.getByRole("button", { name: "Fertig" }))
    await waitFor(() => expect(operationsState.removeMaterial).toHaveBeenCalledOnce())
    expect(onAssignMaterial).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    // The move stays staged: the next «Fertig» (now marking the open change) tries again.
    await user.click(screen.getByRole("button", { name: /^Fertig/ }))
    await waitFor(() => expect(onAssignMaterial).toHaveBeenCalledWith(PUMP.id, "incident-1"))
    expect(operationsState.removeMaterial).toHaveBeenCalledTimes(2)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    operationsState.operations = []
  })

  // Sol review E round 3, S2: released elsewhere since the prompt – free already, so assign.
  it("assigns without a release when the holder no longer holds it", async () => {
    const onAssignMaterial = vi.fn<(materialId: string, operationId: string) => void>()
    const { user, onOpenChange } = await moveThePump(onAssignMaterial, () => {
      operationsState.operations = [{ ...holder, materials: [], materialAssignments: new Map() }]
    })

    await user.click(screen.getByRole("button", { name: /^Fertig/ }))
    await waitFor(() => expect(onAssignMaterial).toHaveBeenCalledWith(PUMP.id, "incident-1"))
    expect(operationsState.removeMaterial).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    operationsState.operations = []
  })

  // Sol review E round 3, S3: while «Fertig» waits for the release the picker is frozen – no
  // tick, no close – and the save closes it once done.
  it("takes no edit and no close while «Fertig» waits for the release", async () => {
    const onAssignMaterial = vi.fn<(materialId: string, operationId: string) => void>()
    const { user, onOpenChange } = await moveThePump(onAssignMaterial)
    let release!: (freed: boolean) => void
    operationsState.removeMaterial.mockReturnValueOnce(new Promise<boolean>((resolve) => { release = resolve }))

    await user.click(screen.getByRole("button", { name: /^Fertig/ }))
    await waitFor(() => expect(screen.getByRole("button", { name: /^Fertig/ })).toBeDisabled())
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Tauchpumpe Gr\./ }))
    await user.keyboard("{Escape}")
    expect(screen.getByText("Änderungen")).toBeDefined()
    expect(onOpenChange).not.toHaveBeenCalled()

    release(true)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onAssignMaterial).toHaveBeenCalledExactlyOnceWith(PUMP.id, "incident-1")
    expect(screen.getByRole("button", { name: /^Fertig/ })).toBeEnabled()
    operationsState.operations = []
  })

  it("changes neither side when the picker closes without «Fertig»", async () => {
    const onAssignMaterial = vi.fn<(materialId: string, operationId: string) => void>()
    const { view } = await moveThePump(onAssignMaterial)
    view.unmount()
    expect(operationsState.removeMaterial).not.toHaveBeenCalled()
    expect(onAssignMaterial).not.toHaveBeenCalled()
    operationsState.operations = []
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
        assignedPersonnelIds={[]}
        assignedVehicleIds={[]}
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

  /**
   * Who lands under «Verfügbar» and who under «Bereits im Einsatz».
   *
   * This has been wrong in both directions. Sorting only on «bound to another
   * incident» put every Magaziner and Fahrer under «Verfügbar», which
   * contradicted the sidebar's own «N frei» two panels away (both now read
   * `isPersonOccupied`). Sorting on `isPersonOccupied` alone then swallowed the
   * crew of the incident being edited, because they are `status: "assigned"`
   * like anyone else — the dialog hid the very people it was opened to change.
   */
  function renderCrewWithAssigned(personnel: Person[], assigned: string[]) {
    return renderWithIntl(
      <ResourceAssignmentDialog
        open
        onOpenChange={vi.fn()}
        resourceType="crew"
        operationId="incident-1"
        personnel={personnel}
        vehicles={[]}
        materials={[]}
        assignedPersonnelIds={assigned}
        assignedVehicleIds={[]}
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

  it("sinks a person holding an Ereignis function under «Bereits im Einsatz»", () => {
    renderCrewWithAssigned(
      [
        person({ name: "Egger Olivier", status: "assigned", isMagazin: true }),
        person({ name: "Frei Anna" }),
      ],
      [],
    )

    expect(screen.getByText(/Bereits im Einsatz · 1/)).toBeDefined()
    expect(screen.getByText(/Verfügbar · 1/)).toBeDefined()
  })

  it("draws «Bereits im Einsatz» quiet: neutral heading and tile, amber only in the note", () => {
    // Owner decision 2026-10: no amber heading, no amber-tinted tiles — the
    // small amber note on the row names where the person is.
    renderCrewWithAssigned(
      [
        person({ name: "Egger Olivier", status: "assigned", isMagazin: true }),
        person({ name: "Frei Anna" }),
      ],
      [],
    )

    const heading = screen.getByText(/Bereits im Einsatz · 1/).closest("h3") as HTMLElement
    expect(heading.className).toContain("text-muted-foreground")
    expect(heading.innerHTML).not.toMatch(/warning/)

    const tile = screen.getByRole("button", { name: /Egger Olivier/ })
    expect(tile.className).not.toMatch(/warning/)
    expect(tile.querySelector('[class*="text-warning-foreground"]')).not.toBeNull()
  })

  it("says every person on ONE line: rank · where (the only amber) · vehicle", () => {
    // Hill climb r23: free, Einsatz and Auftrag tiles had three line layouts and two heights.
    renderWithIntl(
      <ResourceAssignmentDialog
        open
        onOpenChange={vi.fn()}
        resourceType="crew"
        operationId="incident-1"
        personnel={[person({ name: "Egger Olivier", role: "Korporal", status: "assigned", isDriver: true, driverVehicleName: "TLF" })]}
        vehicles={[]}
        materials={[]}
        assignedPersonnelIds={[]}
        assignedVehicleIds={[]}
        assignedMaterials={[]}
        occupiedPersonnelIds={new Set(["Egger Olivier"])}
        onAssignPerson={vi.fn()}
        onAssignVehicle={vi.fn()}
        onAssignMaterial={vi.fn()}
        onRemovePerson={vi.fn()}
        onRemoveVehicle={vi.fn()}
        onRemoveMaterial={vi.fn()}
      />,
    )

    const tile = screen.getByRole("button", { name: /Egger Olivier/ })
    const lines = tile.querySelectorAll("p")
    expect(lines).toHaveLength(2)
    expect(lines[1].textContent).toBe("Kpl·Im Einsatz·TLF")
    expect(lines[1].getAttribute("title")).toBe("Korporal · Im Einsatz · TLF")
    const amber = tile.querySelectorAll('[class*="text-warning-foreground"]')
    expect(amber).toHaveLength(1)
    expect(amber[0].textContent).toBe("Im Einsatz")
  })

  it("makes a place-like role the where-note of a person on no Einsatz", () => {
    renderCrew([person({ name: "Müller Hans", role: "Offizier", isReko: true, isDriver: true, driverVehicleName: "TLF" })])
    const tile = screen.getByRole("button", { name: /Müller Hans/ })
    expect(tile.querySelectorAll("p")[1].textContent).toBe("Of·Reko·TLF")
    expect(tile.querySelector('[class*="text-warning-foreground"]')?.textContent).toBe("Reko")
  })

  it("keeps the crew of THIS incident under «Verfügbar», ticked", () => {
    renderCrewWithAssigned(
      [
        person({ name: "Egger Olivier", status: "assigned" }),
        person({ name: "Frei Anna" }),
      ],
      ["Egger Olivier"],
    )

    // Both free: the one on this incident is selected, not "busy elsewhere".
    expect(screen.getByText(/Verfügbar · 2/)).toBeDefined()
    expect(screen.queryByText(/Bereits im Einsatz/)).toBeNull()
  })

  it("tells two people who share a name apart: the ticks move the right ids", async () => {
    const user = userEvent.setup()
    const onAssignPerson = vi.fn()
    const onRemovePerson = vi.fn()
    renderWithIntl(
      <ResourceAssignmentDialog
        open
        onOpenChange={vi.fn()}
        resourceType="crew"
        operationId="incident-1"
        personnel={[
          person({ id: "p-1", name: "Meier Alex", status: "assigned" }),
          person({ id: "p-2", name: "Meier Alex", role: "Korporal" }),
        ]}
        vehicles={[]}
        materials={[]}
        assignedPersonnelIds={["p-1"]}
        assignedVehicleIds={[]}
        assignedMaterials={[]}
        onAssignPerson={onAssignPerson}
        onAssignVehicle={vi.fn()}
        onAssignMaterial={vi.fn()}
        onRemovePerson={onRemovePerson}
        onRemoveVehicle={vi.fn()}
        onRemoveMaterial={vi.fn()}
      />,
    )

    expect(screen.getAllByRole("button", { name: /Meier Alex/ })).toHaveLength(2)
    // Swap them: untick the one on this incident, tick the namesake.
    await user.click(screen.getByRole("button", { name: /Meier Alex\s*Sdt/ }))
    await user.click(screen.getByRole("button", { name: /Meier Alex\s*Kpl/ }))
    await user.click(screen.getByRole("button", { name: /Fertig/ }))

    expect(onAssignPerson).toHaveBeenCalledExactlyOnceWith("p-2", "Meier Alex", "incident-1")
    expect(onRemovePerson).toHaveBeenCalledExactlyOnceWith("incident-1", "p-1")
  })

  it("finds a person by their special function in the search", async () => {
    const user = userEvent.setup()
    renderCrew([
      person({ name: "Egger Olivier", isKommandoposten: true }),
      person({ name: "Frei Anna" }),
    ])

    await user.type(screen.getByPlaceholderText("Person suchen …"), "kommandoposten")

    expect(screen.getByRole("button", { name: /Egger Olivier/ })).toBeDefined()
    expect(screen.queryByRole("button", { name: /Frei Anna/ })).toBeNull()
  })

  // Sign-off 24.11.2026: «Niemand ist frei» under a search that only matched busy people,
  // although Frei Anna is free.
  it("says the search found no free one, not that nobody is free", async () => {
    const user = userEvent.setup()
    renderCrew([
      person({ name: "Egger Olivier", status: "assigned", isMagazin: true }),
      person({ name: "Frei Anna" }),
    ])

    await user.type(screen.getByPlaceholderText("Person suchen …"), "egger")

    expect(screen.getByText(/Verfügbar · 0/)).toBeDefined()
    expect(screen.getByText("Keine Treffer für «egger»")).toBeDefined()
    expect(screen.queryByText(/Niemand ist frei/)).toBeNull()
  })
})

describe("readiness from the operations context", () => {
  it("greys an out-of-service vehicle although the caller passed no flag", () => {
    // The map and the Auftrag path pass bare fleet lists — the dialog must
    // still know the vehicle is «Nicht einsatzbereit».
    operationsState.outOfServiceVehicleIds = new Set(["v1"])
    try {
      renderWithIntl(
        <ResourceAssignmentDialog
          open
          onOpenChange={vi.fn()}
          resourceType="vehicles"
          operationId="incident-1"
          personnel={[]}
          vehicles={[{ id: "v1", name: "TLF", type: "Tanklöschfahrzeug" }]}
          materials={[]}
          assignedPersonnelIds={[]}
          assignedVehicleIds={[]}
          assignedMaterials={[]}
          onAssignPerson={vi.fn()}
          onAssignVehicle={vi.fn()}
          onAssignMaterial={vi.fn()}
          onRemovePerson={vi.fn()}
          onRemoveVehicle={vi.fn()}
          onRemoveMaterial={vi.fn()}
        />,
      )

      const tile = screen.getByRole("button", { name: /TLF/ })
      expect(tile).toBeDisabled()
      expect(tile.textContent).toContain("Nicht einsatzbereit")
    } finally {
      operationsState.outOfServiceVehicleIds = new Set()
    }
  })
})

describe("vor Ort / zurück in the vehicle assignment", () => {
  const TLF = { id: "v1", name: "TLF", type: "Tanklöschfahrzeug" }
  const PIO = { id: "v2", name: "Pio", type: "Pionier" }

  function renderVehicles(onToggleDriverStay?: (vehicleId: string) => void) {
    return renderWithIntl(
      <ResourceAssignmentDialog
        open
        onOpenChange={vi.fn()}
        resourceType="vehicles"
        operationId="incident-1"
        personnel={[]}
        vehicles={[TLF, PIO]}
        materials={[]}
        assignedPersonnelIds={[]}
        assignedVehicleIds={[TLF.id]}
        assignedMaterials={[]}
        onAssignPerson={vi.fn()}
        onAssignVehicle={vi.fn()}
        onAssignMaterial={vi.fn()}
        onRemovePerson={vi.fn()}
        onRemoveVehicle={vi.fn()}
        onRemoveMaterial={vi.fn()}
        vehicleDriverStay={new Map([[TLF.id, false]])}
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
    expect(onToggle).toHaveBeenCalledWith(TLF.id)
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

import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"

import type { Material } from "@/lib/contexts/materials-context"

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

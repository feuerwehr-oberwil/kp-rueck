import { useState } from "react"
import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  IncidentStatusWorkflowDialogs,
  useIncidentStatusWorkflow,
  type IncidentStatusWorkflowController,
} from "@/components/kanban/incident-status-workflow"
import type { Operation } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"
import { renderWithIntl } from "@/test-utils/render-with-intl"

/**
 * «Ressourcen fehlen» — press twice (owner pick UX-DESKTOP-09 B, + C's «Zu Fuss»).
 * «Disponieren» is never greyed out: with a blocking gap the first press arms it
 * and names the consequence, the second dispatches, Zurück/Esc disarm.
 */

vi.mock("@/lib/api-client", () => ({ apiClient: {} }))
// The gate's neighbours need the board's contexts; this file is about the gate.
vi.mock("@/components/kanban/disponiert-transition-dialog", () => ({ DisponierTransitionDialog: () => null }))
vi.mock("@/components/incidents/assign-reko-dialog", () => ({ AssignRekoDialog: () => null }))

const noRoute: GroupResources = { personnel: [], vehicles: [], materials: [] }

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "incident-1",
    location: "Bahnhofstrasse 22",
    locationDisplay: "Bahnhofstrasse 22",
    vehicle: null,
    vehicles: [],
    incidentType: "elementarereignis",
    dispatchTime: new Date("2026-10-24T18:00:00Z"),
    crew: ["Ackermann Reto"],
    priority: "medium",
    status: "enroute",
    coordinates: null,
    materials: ["m1"],
    notes: "",
    contact: "",
    contactPhone: "",
    internalNotes: "",
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    amWarten: false,
    amWartenNote: "",
    zuFuss: false,
    groupId: null,
    groupPosition: 0,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    leaderName: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  }
}

function renderGate(initial: Operation) {
  const onOpenAssignment = vi.fn()
  const changeStatusToTop = vi.fn()
  const ref: { controller: IncidentStatusWorkflowController | null } = { controller: null }

  function Harness() {
    const [current, setCurrent] = useState(initial)
    const controller = useIncidentStatusWorkflow({
      operations: [current],
      materials: [],
      groups: [],
      changeStatusToTop,
      getGroupResources: () => noRoute,
      removeMaterial: vi.fn(),
      unassignGroupResource: vi.fn(),
    })
    ref.controller = controller
    return (
      <IncidentStatusWorkflowDialogs
        controller={controller}
        printerEnabled={false}
        funkrufname=""
        diveraEnabled={false}
        onOpenAssignment={onOpenAssignment}
        onToggleZuFuss={(op) => setCurrent({ ...op, zuFuss: !op.zuFuss })}
        onOpenDetail={vi.fn()}
        onSendDivera={vi.fn()}
        onRefresh={vi.fn()}
      />
    )
  }

  renderWithIntl(<Harness />)
  act(() => ref.controller!.triggerDisponiertDialog(initial.id, "incoming"))
  return { ref, onOpenAssignment, changeStatusToTop }
}

describe("dispatch gate – press twice", () => {
  it("arms on the first press, names the gap, and dispatches on the second", async () => {
    const user = userEvent.setup()
    const { ref } = renderGate(operation())

    const dispatch = screen.getByRole("button", { name: "Disponieren" })
    expect(dispatch).toBeEnabled()
    expect(screen.queryByRole("button", { name: /Trotzdem/ })).toBeNull()

    await user.click(dispatch)
    expect(ref.controller!.disponiertOperation).toBeNull()
    expect(screen.getByText("Kein Fahrzeug – wirklich so ausrücken?")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Zurück" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Ja, ohne Fahrzeug disponieren" }))
    expect(ref.controller!.disponiertOperation?.id).toBe("incident-1")
  })

  it("Enter twice is the keyboard path: the button has the focus", async () => {
    const user = userEvent.setup()
    const { ref } = renderGate(operation())

    expect(screen.getByRole("button", { name: "Disponieren" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("button", { name: "Ja, ohne Fahrzeug disponieren" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(ref.controller!.disponiertOperation?.id).toBe("incident-1")
  })

  it("Esc while armed only disarms; Esc again cancels and puts the card back", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderGate(operation())

    await user.click(screen.getByRole("button", { name: "Disponieren" }))
    await user.keyboard("{Escape}")
    expect(ref.controller!.missingResourcesOperation?.id).toBe("incident-1")
    expect(screen.getByRole("button", { name: "Disponieren" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeInTheDocument()
    expect(changeStatusToTop).not.toHaveBeenCalled()

    await user.keyboard("{Escape}")
    expect(ref.controller!.missingResourcesOperation).toBeNull()
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "incoming")
  })

  it("Zurück disarms without leaving the gate", async () => {
    const user = userEvent.setup()
    const { ref } = renderGate(operation())

    await user.click(screen.getByRole("button", { name: "Disponieren" }))
    await user.click(screen.getByRole("button", { name: "Zurück" }))
    expect(ref.controller!.missingResourcesOperation?.id).toBe("incident-1")
    expect(screen.getByRole("button", { name: "Disponieren" })).toBeInTheDocument()
  })

  it("names both gaps when crew and vehicle are missing", async () => {
    const user = userEvent.setup()
    renderGate(operation({ crew: [] }))

    await user.click(screen.getByRole("button", { name: "Disponieren" }))
    expect(screen.getByRole("button", { name: "Ja, ohne Mannschaft und Fahrzeug disponieren" })).toBeInTheDocument()
    expect(screen.getByText("Keine Mannschaft – wirklich so ausrücken?")).toBeInTheDocument()
  })

  it("«Zu Fuss» answers the vehicle gap: one press dispatches", async () => {
    const user = userEvent.setup()
    const { ref } = renderGate(operation())

    const zuFuss = screen.getByRole("button", { name: "Zu Fuss" })
    expect(zuFuss).toHaveAttribute("aria-pressed", "false")
    await user.click(zuFuss)
    expect(screen.getByRole("button", { name: "Zu Fuss" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Alles bereit")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Disponieren" }))
    expect(ref.controller!.disponiertOperation?.id).toBe("incident-1")
  })

  it("«Zuweisen» on the vehicle row opens the vehicle assignment", async () => {
    const user = userEvent.setup()
    const { onOpenAssignment } = renderGate(operation())

    await user.click(screen.getByRole("button", { name: "Zuweisen" }))
    expect(onOpenAssignment).toHaveBeenCalledWith("vehicles", "incident-1")
  })

  it("material alone does not arm: one press dispatches", async () => {
    const user = userEvent.setup()
    const { ref } = renderGate(operation({ vehicles: ["TLF"], materials: [] }))

    await user.click(screen.getByRole("button", { name: "Disponieren" }))
    expect(ref.controller!.disponiertOperation?.id).toBe("incident-1")
  })
})

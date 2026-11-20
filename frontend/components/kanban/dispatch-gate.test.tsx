import { useState } from "react"
import { act, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  IncidentStatusWorkflowDialogs,
  useIncidentStatusWorkflow,
  type IncidentStatusWorkflowController,
} from "@/components/kanban/incident-status-workflow"
import type { Operation } from "@/lib/contexts/operations-context"
import type { GroupResources, IncidentGroup } from "@/lib/types/groups"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import { crewMember, assignedVehicle } from "@/test-utils/operation-fixtures"

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
    crew: [crewMember("Ackermann Reto")],
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
    leaderId: null,
    leaderName: null,
    materialAssignments: new Map(),
    ...overrides,
  }
}

function auftrag(id: string, stopIds: string[]): IncidentGroup {
  const at = new Date("2026-10-24T18:00:00Z")
  return {
    id, eventId: "e1", name: "Auftrag 1", color: null, notes: null, position: 0, createdAt: at, updatedAt: at,
    createdBy: null, stopIds, assignments: [], progress: { total: stopIds.length, done: 0 }, lastAnnounced: null,
  }
}

function renderGate(initial: Operation, { groups = [], route = noRoute }: { groups?: IncidentGroup[]; route?: GroupResources } = {}) {
  const onOpenAssignment = vi.fn()
  const onSetDriverStay = vi.fn()
  const onPromoteLeader = vi.fn()
  const changeStatusToTop = vi.fn()
  const ref: { controller: IncidentStatusWorkflowController | null } = { controller: null }

  function Harness() {
    const [current, setCurrent] = useState(initial)
    const controller = useIncidentStatusWorkflow({
      operations: [current],
      materials: [],
      groups,
      changeStatusToTop,
      getGroupResources: () => route,
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
        onSendDivera={vi.fn()}
        onRefresh={vi.fn()}
        vehicleDrivers={new Map([["v-TLF", { name: "Baumann Michael", personnelId: "p-baumann" }]])}
        onSetDriverStay={onSetDriverStay}
        onPromoteLeader={onPromoteLeader}
      />
    )
  }

  renderWithIntl(<Harness />)
  act(() => ref.controller!.triggerDisponiertDialog(initial.id, "incoming"))
  return { ref, onOpenAssignment, changeStatusToTop, onSetDriverStay, onPromoteLeader }
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

    await user.click(screen.getByRole("button", { name: "Ohne Fahrzeug disponieren" }))
    expect(ref.controller!.disponiertOperation?.id).toBe("incident-1")
  })

  it("Enter twice is the keyboard path: the button has the focus", async () => {
    const user = userEvent.setup()
    const { ref } = renderGate(operation())

    expect(screen.getByRole("button", { name: "Disponieren" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("button", { name: "Ohne Fahrzeug disponieren" })).toHaveFocus()
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
    expect(screen.getByRole("button", { name: "Ohne Mannschaft und Fahrzeug disponieren" })).toBeInTheDocument()
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

  it("an empty Material box says «Hinzufügen» like a filled one and opens the material picker", async () => {
    const user = userEvent.setup()
    const { onOpenAssignment } = renderGate(operation({ vehicles: [assignedVehicle("TLF")], materials: [] }))

    const box = screen.getByRole("group", { name: "Material" })
    expect(within(box).queryByRole("button", { name: /Zuweisen/ })).not.toBeInTheDocument()
    await user.click(within(box).getByRole("button", { name: "Hinzufügen" }))
    expect(onOpenAssignment).toHaveBeenCalledWith("materials", "incident-1")
  })

  it("material alone does not arm: one press dispatches", async () => {
    const user = userEvent.setup()
    const { ref } = renderGate(operation({ vehicles: [assignedVehicle("TLF")], materials: [] }))

    await user.click(screen.getByRole("button", { name: "Disponieren" }))
    expect(ref.controller!.disponiertOperation?.id).toBe("incident-1")
  })

  it("names what is there: crew EL first, «TLF · Fahrer» with its stay toggle, Geräte by name", async () => {
    const user = userEvent.setup()
    const { onSetDriverStay } = renderGate(operation({
      crew: [crewMember("Ackermann Reto"), crewMember("Meier Andrea")],
      leaderId: "p-Meier Andrea",
      vehicles: [assignedVehicle("TLF", { driverStay: false })],
      materials: [],
    }))

    const crew = screen.getByRole("group", { name: "Mannschaft" })
    expect(crew).toHaveTextContent("Mannschaft · 2")
    expect(crew.textContent!.indexOf("Meier Andrea")).toBeLessThan(crew.textContent!.indexOf("Ackermann Reto"))
    // The current EL is a read-only mark, not a button: a tap on it must not fall through to
    // the box's picker on a touch screen.
    expect(screen.getByLabelText("Einsatzleiter")).toHaveTextContent("EL")
    expect(screen.queryByRole("button", { name: "Einsatzleiter" })).not.toBeInTheDocument()

    const vehicles = screen.getByRole("group", { name: "Fahrzeuge" })
    expect(vehicles).toHaveTextContent("TLF · Baumann Michael")
    expect(screen.getByRole("button", { name: "kehrt zurück" })).toHaveAttribute("aria-pressed", "true")
    await user.click(screen.getByRole("button", { name: "bleibt vor Ort" }))
    expect(onSetDriverStay).toHaveBeenCalledWith({ kind: "incident", operationId: "incident-1", vehicleId: "v-TLF" }, true)
    // The half already set writes nothing.
    await user.click(screen.getByRole("button", { name: "kehrt zurück" }))
    expect(onSetDriverStay).toHaveBeenCalledTimes(1)
  })

  it("the «EL» stub makes that person EL – without opening the picker – and hands Enter back to «Disponieren»", async () => {
    const user = userEvent.setup()
    const { onPromoteLeader, onOpenAssignment } = renderGate(operation({
      crew: [crewMember("Ackermann Reto"), crewMember("Meier Andrea")],
      leaderId: "p-Meier Andrea",
    }))

    await user.click(screen.getByRole("button", { name: "Als Einsatzleiter markieren" }))
    expect(onPromoteLeader).toHaveBeenCalledWith({ kind: "incident", operationId: "incident-1", personnelId: "p-Ackermann Reto" })
    expect(onOpenAssignment).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Disponieren" })).toHaveFocus()
  })

  it("a stop's own crew offers no stub – the Auftrag leads; its route crew does", async () => {
    const user = userEvent.setup()
    const { onPromoteLeader } = renderGate(operation({ groupId: "g1" }), {
      groups: [auftrag("g1", ["incident-1"])],
      route: { ...noRoute, personnel: [{ resourceId: "p-weber", assignmentId: "ga-1", name: "Weber Martin", isLeader: false }] },
    })

    const stubs = screen.getAllByRole("button", { name: "Als Einsatzleiter markieren" })
    expect(stubs).toHaveLength(1)
    await user.click(stubs[0])
    expect(onPromoteLeader).toHaveBeenCalledWith({ kind: "route", groupId: "g1", assignmentId: "ga-1" })
  })

  it("the box's action is its one opener: stretched over the box, with chips and toggles lifted above it", () => {
    renderGate(operation({ vehicles: [assignedVehicle("TLF", { driverStay: false })], materials: [] }))

    const vehicles = screen.getByRole("group", { name: "Fahrzeuge" })
    const openers = vehicles.querySelectorAll("[data-gate-open]")
    expect(openers).toHaveLength(1)
    expect(openers[0]).toHaveAccessibleName("Hinzufügen")
    expect(openers[0].className).toMatch(/after:absolute after:inset-0/)
    expect(screen.getByRole("group", { name: "TLF" }).className).toMatch(/relative z-10/)
    // A read-only name stays under the opener: a click on it opens the picker.
    expect(within(vehicles).getByText("TLF").closest("[data-slot=badge]")!.className).not.toMatch(/z-10/)
  })

  it("with a mouse a click on a crew name opens the Mannschaft picker", async () => {
    const user = userEvent.setup()
    const { onOpenAssignment } = renderGate(operation())

    await user.click(screen.getByText("Ackermann Reto"))
    expect(onOpenAssignment).toHaveBeenCalledWith("crew", "incident-1")
  })

  it("under an Auftrag only the route's leader is marked, not the stop's earlier EL", () => {
    renderGate(operation({ groupId: "g1", leaderId: "p-Meier Andrea", crew: [crewMember("Meier Andrea")] }), {
      groups: [auftrag("g1", ["incident-1"])],
      route: { ...noRoute, personnel: [{ resourceId: "p-weber", assignmentId: "ga-1", name: "Weber Martin", isLeader: true }] },
    })

    expect(screen.getAllByLabelText("Einsatzleiter")).toHaveLength(1)
    const crew = screen.getByRole("group", { name: "Mannschaft" })
    expect(crew.textContent!.indexOf("Weber Martin")).toBeLessThan(crew.textContent!.indexOf("Meier Andrea"))
  })
})

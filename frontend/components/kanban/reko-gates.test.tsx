import { useState } from "react"
import { act, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Operation } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"
import { renderWithIntl } from "@/test-utils/render-with-intl"

/**
 * The two Reko gates open the next step at once (owner pick 19.11.2026, #4 A): into «Reko»
 * without a Reko person → the Reko picker; into «Reko abgeschlossen» without a report → the
 * Reko form, and the card waits for it.
 */

const getAvailableRekoPersonnel = vi.hoisted(() => vi.fn())
const assignRekoPersonnel = vi.hoisted(() => vi.fn())
const getIncidentRekoReports = vi.hoisted(() => vi.fn())
const createRekoReportAsEditor = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api-client", () => ({
  apiClient: { getAvailableRekoPersonnel, assignRekoPersonnel, getIncidentRekoReports, createRekoReportAsEditor },
}))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: { id: "event-1" } }) }))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ personnel: [], operations: [], refreshOperations: vi.fn(), formatLocation: (a: string) => a }),
}))
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }))
vi.mock("@/components/kanban/disponiert-transition-dialog", () => ({ DisponierTransitionDialog: () => null }))

import {
  IncidentStatusWorkflowDialogs,
  useIncidentStatusWorkflow,
  type IncidentStatusWorkflowController,
} from "@/components/kanban/incident-status-workflow"

const noRoute: GroupResources = { personnel: [], vehicles: [], materials: [] }

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "incident-1",
    location: "Bahnhofstrasse 22",
    locationDisplay: "Bahnhofstrasse 22",
    vehicle: null,
    vehicles: [],
    incidentType: "elementarereignis",
    dispatchTime: new Date("2026-11-19T18:00:00Z"),
    crew: [],
    priority: "medium",
    status: "incoming",
    coordinates: null,
    materials: [],
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

function renderBoard(initial: Operation) {
  const changeStatusToTop = vi.fn()
  const ref: { controller: IncidentStatusWorkflowController | null } = { controller: null }

  function Harness() {
    const [current] = useState(initial)
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
        onOpenAssignment={vi.fn()}
        onToggleZuFuss={vi.fn()}
        onSendDivera={vi.fn()}
        onRefresh={vi.fn()}
      />
    )
  }

  renderWithIntl(<Harness />)
  return { ref, changeStatusToTop }
}

beforeEach(() => {
  getAvailableRekoPersonnel.mockReset().mockResolvedValue({
    personnel: [{ personnel_id: "p1", name: "Brunner Sarah", role: "Wm", open_count: 0, done_count: 0, distance_m: null, distance_source: null, open_assignments: [] }],
    currently_assigned_id: null,
  })
  assignRekoPersonnel.mockReset().mockResolvedValue(undefined)
  getIncidentRekoReports.mockReset().mockResolvedValue([])
  createRekoReportAsEditor.mockReset().mockResolvedValue({ id: "draft-1" })
})

describe("Reko gate – into «Reko» without a Reko person", () => {
  it("opens the picker at once; Abbrechen puts the card back", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation())

    act(() => ref.controller!.requestStatusChange("incident-1", "reko"))
    expect(await screen.findByRole("dialog", { name: "Reko-Person für Bahnhofstrasse 22" })).toBeInTheDocument()
    expect(screen.getByText("Die Karte wandert mit der Zuweisung nach «Reko».")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "incoming")
    expect(ref.controller!.rekoAssignmentOperation).toBeNull()
  })

  it("«Zuweisen» assigns the picked person and the move stays", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation())

    act(() => ref.controller!.requestStatusChange("incident-1", "reko"))
    await user.click(await screen.findByRole("radio", { name: /Brunner Sarah/ }))
    await user.click(screen.getByRole("button", { name: "Zuweisen" }))

    await waitFor(() => expect(ref.controller!.rekoAssignmentOperation).toBeNull())
    expect(assignRekoPersonnel).toHaveBeenCalledWith("incident-1", "p1")
    expect(changeStatusToTop).toHaveBeenCalledTimes(1)
  })

  it("«Ohne Reko-Person verschieben» keeps the move without anybody", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation())

    act(() => ref.controller!.requestStatusChange("incident-1", "reko"))
    await user.click(await screen.findByRole("button", { name: "Ohne Reko-Person verschieben" }))

    expect(ref.controller!.rekoAssignmentOperation).toBeNull()
    expect(assignRekoPersonnel).not.toHaveBeenCalled()
    expect(changeStatusToTop).toHaveBeenCalledTimes(1)
  })
})

describe("Reko gate – into «Reko abgeschlossen» without a report", () => {
  it("opens the form while the card waits; Abbrechen leaves it where it was", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation({ status: "reko", assignedReko: { id: "p1", name: "Brunner Sarah" } }))

    act(() => ref.controller!.requestStatusChange("incident-1", "reko_done"))
    expect(await screen.findByRole("dialog", { name: "Reko-Bericht · Bahnhofstrasse 22" })).toBeInTheDocument()
    expect(changeStatusToTop).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(ref.controller!.rekoReportOperation).toBeNull()
    expect(changeStatusToTop).not.toHaveBeenCalled()
  })

  it("«Ohne Bericht abschliessen» moves the card with an untouched form", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation({ status: "reko" }))

    act(() => ref.controller!.requestStatusChange("incident-1", "reko_done"))
    await user.click(await screen.findByRole("button", { name: "Ohne Bericht abschliessen" }))

    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "reko_done")
    expect(createRekoReportAsEditor).not.toHaveBeenCalled()
  })

  it("«Reko abschliessen» saves the draft first, then moves the card", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation({ status: "reko" }))

    act(() => ref.controller!.requestStatusChange("incident-1", "reko_done"))
    await user.click(await screen.findByRole("button", { name: "Ja" }))
    // An answer makes it a report: the quiet way out without one is gone.
    expect(screen.queryByRole("button", { name: "Ohne Bericht abschliessen" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Reko abschliessen" }))
    await waitFor(() => expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "reko_done"))
    expect(createRekoReportAsEditor).toHaveBeenCalledWith("incident-1", expect.objectContaining({ is_relevant: true }), false)
    expect(createRekoReportAsEditor.mock.invocationCallOrder[0]).toBeLessThan(changeStatusToTop.mock.invocationCallOrder[0])
  })
})

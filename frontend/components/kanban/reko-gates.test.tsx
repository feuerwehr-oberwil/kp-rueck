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
const assignSpecialFunction = vi.hoisted(() => vi.fn())
// The Ereignis' checked-in people: one Reko person, two others.
const checkedIn = vi.hoisted(() => [
  { id: "p1", name: "Brunner Sarah", role: "Wm", status: "available", roleSortOrder: 0, isReko: true },
  { id: "p2", name: "Moser Lea", role: "Kpl", status: "available", roleSortOrder: 0, isReko: false },
  { id: "p3", name: "Steiner Lukas", role: "Kpl", status: "available", roleSortOrder: 0, isReko: false },
])

vi.mock("@/lib/api-client", () => ({
  apiClient: { getAvailableRekoPersonnel, assignRekoPersonnel, getIncidentRekoReports, createRekoReportAsEditor, assignSpecialFunction },
}))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: { id: "event-1" } }) }))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ personnel: checkedIn, operations: [], refreshOperations: vi.fn(), formatLocation: (a: string) => a }),
}))
vi.mock("@/lib/contexts/groups-context", () => ({ useGroups: () => ({ groups: [] }) }))
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
  assignSpecialFunction.mockReset().mockResolvedValue({})
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

  it("lists «Andere Anwesende» below the Reko people; one «Zuweisen» makes the pick Reko and assigns", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation())

    act(() => ref.controller!.requestStatusChange("incident-1", "reko"))
    expect(await screen.findByRole("heading", { name: "Reko-Personen" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Andere Anwesende" })).toBeInTheDocument()
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([
      expect.stringContaining("Brunner Sarah"),
      expect.stringContaining("Moser Lea"),
      expect.stringContaining("Steiner Lukas"),
    ])

    // One choice across both sections.
    await user.click(screen.getByRole("radio", { name: /Brunner Sarah/ }))
    await user.click(screen.getByRole("radio", { name: /Moser Lea/ }))
    expect(screen.getByRole("radio", { name: /Brunner Sarah/ })).toHaveAttribute("aria-checked", "false")

    await user.click(screen.getByRole("button", { name: "Zuweisen" }))
    await waitFor(() => expect(ref.controller!.rekoAssignmentOperation).toBeNull())
    expect(assignSpecialFunction).toHaveBeenCalledWith("event-1", { personnel_id: "p2", function_type: "reko", vehicle_id: null })
    expect(assignRekoPersonnel).toHaveBeenCalledWith("incident-1", "p2")
    expect(changeStatusToTop).toHaveBeenCalledTimes(1)
  })

  it("the search filters both sections", async () => {
    const user = userEvent.setup()
    const { ref } = renderBoard(operation())

    act(() => ref.controller!.requestStatusChange("incident-1", "reko"))
    await user.type(await screen.findByPlaceholderText("Person suchen …"), "steiner")

    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual([expect.stringContaining("Steiner Lukas")])
    expect(screen.queryByRole("heading", { name: "Reko-Personen" })).toBeNull()

    await user.clear(screen.getByPlaceholderText("Person suchen …"))
    await user.type(screen.getByPlaceholderText("Person suchen …"), "niemand")
    expect(screen.getByText(/Keine Treffer/)).toBeInTheDocument()
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

  it("waits for «Einsatz relevant?»: «Ohne Bericht abschliessen» moves without filing, the draft stays", async () => {
    const user = userEvent.setup()
    const { ref, changeStatusToTop } = renderBoard(operation({ status: "reko" }))

    act(() => ref.controller!.requestStatusChange("incident-1", "reko_done"))
    const finish = await screen.findByRole("button", { name: "Reko abschliessen" })
    expect(finish).toBeDisabled()
    expect(finish).toHaveAccessibleDescription(/Eingereicht wird mit der Antwort auf «Einsatz relevant\?»/)

    // Content without the answer is a draft – the quiet way out stays, and says so.
    await user.type(screen.getByRole("textbox", { name: "Zusammenfassung" }), "Keller nass")
    expect(screen.getByText(/lässt das Erfasste als Entwurf/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Ohne Bericht abschliessen" }))

    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "reko_done")
    // The waiting save still goes out on close – as a draft: no relevance answer, no filing.
    await waitFor(() => expect(createRekoReportAsEditor).toHaveBeenCalled())
    for (const [, payload] of createRekoReportAsEditor.mock.calls) expect(payload).not.toHaveProperty("is_relevant")
  })

  it("«Reko abschliessen» waits until the save carrying the answer settled, then moves", async () => {
    const user = userEvent.setup()
    let answer: (report: unknown) => void = () => {}
    createRekoReportAsEditor.mockImplementation((_id: string, payload: object) =>
      new Promise((resolve) => {
        answer = () => resolve({ id: "draft-1", updated_at: "2026-11-19T18:31:00Z", ...payload })
      }))
    const { ref, changeStatusToTop } = renderBoard(operation({ status: "reko" }))

    act(() => ref.controller!.requestStatusChange("incident-1", "reko_done"))
    await user.click(await screen.findByRole("button", { name: "Ja" }))
    // Answered: no way out without a report any more.
    expect(screen.queryByRole("button", { name: "Ohne Bericht abschliessen" })).toBeNull()

    await user.click(screen.getByRole("button", { name: "Reko abschliessen" }))
    // The save that files is on its way; the card waits for it.
    expect(createRekoReportAsEditor).toHaveBeenCalledWith("incident-1", { is_relevant: true }, false)
    expect(changeStatusToTop).not.toHaveBeenCalled()

    await act(async () => answer(null))
    await waitFor(() => expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "reko_done"))
    expect(ref.controller!.rekoReportOperation).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Person } from "@/lib/contexts/personnel-context"

const state = vi.hoisted(() => ({ personnel: [] as Person[], operations: [] as unknown[] }))
const assignSpecialFunction = vi.hoisted(() => vi.fn())
const unassignSpecialFunction = vi.hoisted(() => vi.fn())
const getAvailableRekoPersonnel = vi.hoisted(() => vi.fn())
const assignRekoPersonnel = vi.hoisted(() => vi.fn())
const transferRekoAssignments = vi.hoisted(() => vi.fn())
const refreshOperations = vi.hoisted(() => vi.fn())

vi.mock("@/lib/contexts/event-context", () => ({
  useEvent: () => ({ selectedEvent: { id: "event-1" } }),
}))

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ personnel: state.personnel, operations: state.operations, refreshOperations, formatLocation: (address: string) => address }),
}))
vi.mock("@/lib/contexts/groups-context", () => ({ useGroups: () => ({ groups: [] }) }))

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    assignSpecialFunction,
    unassignSpecialFunction,
    getAvailableRekoPersonnel,
    assignRekoPersonnel,
    transferRekoAssignments,
  },
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { TransferRekoDialog } from "@/components/kanban/transfer-reko-dialog"
import { AssignRekoDialog } from "@/components/incidents/assign-reko-dialog"

const person = (id: string, name: string, isReko: boolean): Person => ({
  id,
  name,
  role: "AdF",
  status: "available",
  roleSortOrder: 0,
  isReko,
})

const source = person("source", "Reko Quelle", true)
const existingTarget = person("target", "Reko Ziel", true)
const checkedInCandidate = person("candidate", "Neue Reko", false)

beforeEach(() => {
  state.personnel = [source, checkedInCandidate]
  state.operations = []
  assignSpecialFunction.mockReset().mockResolvedValue({})
  unassignSpecialFunction.mockReset().mockResolvedValue(undefined)
  getAvailableRekoPersonnel.mockReset().mockResolvedValue({ personnel: [], currently_assigned_id: null })
  assignRekoPersonnel.mockReset().mockResolvedValue(undefined)
  transferRekoAssignments.mockReset().mockResolvedValue({ transferred_count: 1, incident_ids: ["incident-1"] })
  refreshOperations.mockReset().mockResolvedValue(undefined)
})

describe("TransferRekoDialog", () => {
  it("marks a checked-in person as event Reko before transferring all assignments", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onTransferred = vi.fn()

    renderWithIntl(
      <TransferRekoDialog
        open
        onOpenChange={onOpenChange}
        fromPerson={source}
        rekoPersonnel={[source]}
        onTransferred={onTransferred}
      />,
    )

    expect(screen.getByText("Keine anderen Reko-Personen verfügbar")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Person als Reko markieren" }))
    await user.click(screen.getByRole("radio", { name: /Neue Reko/ }))
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(transferRekoAssignments).toHaveBeenCalledTimes(1))
    expect(assignSpecialFunction).toHaveBeenCalledWith("event-1", {
      personnel_id: "candidate",
      function_type: "reko",
      vehicle_id: null,
    })
    expect(assignSpecialFunction.mock.invocationCallOrder[0]).toBeLessThan(
      transferRekoAssignments.mock.invocationCallOrder[0],
    )
    expect(transferRekoAssignments).toHaveBeenCalledWith("source", "candidate", "event-1")
    expect(onTransferred).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("offers marking a non-Reko person even when an existing Reko target is available", () => {
    renderWithIntl(
      <TransferRekoDialog
        open
        onOpenChange={vi.fn()}
        fromPerson={source}
        rekoPersonnel={[source, existingTarget]}
        onTransferred={vi.fn()}
      />,
    )

    expect(screen.getByRole("radio", { name: /Reko Ziel/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Person als Reko markieren" })).toBeInTheDocument()
  })

  // #6 (19.11.2026): a candidate's tile says where they are and what else they hold, like the
  // Fahrer picker – and stays choosable.
  it("shows a candidate's Einsatz and roles on the one tile line, as a single choice", async () => {
    const user = userEvent.setup()
    state.personnel = [source, { ...checkedInCandidate, isMagazin: true }]
    state.operations = [{ id: "op-1", number: 7, location: "Hauptstrasse 5", locationDisplay: "Hauptstrasse 5", crew: [{ personnelId: "candidate" }] }]
    renderWithIntl(
      <TransferRekoDialog open onOpenChange={vi.fn()} fromPerson={source} rekoPersonnel={[source]} onTransferred={vi.fn()} />,
    )

    await user.click(screen.getByRole("button", { name: "Person als Reko markieren" }))
    const tile = screen.getByRole("radio", { name: /Neue Reko/ })
    expect(tile).toHaveTextContent("7 · Hauptstrasse 5")
    expect(tile).toHaveTextContent("Magazin")
    expect(screen.getByRole("radiogroup", { name: "Person als Reko markieren" })).toContainElement(tile)
    await user.click(tile)
    expect(tile).toHaveAttribute("aria-checked", "true")
  })

  it("preserves direct transfer to an existing Reko target", async () => {
    const user = userEvent.setup()

    renderWithIntl(
      <TransferRekoDialog
        open
        onOpenChange={vi.fn()}
        fromPerson={source}
        rekoPersonnel={[source, existingTarget]}
        onTransferred={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("radio", { name: /Reko Ziel/ }))
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(transferRekoAssignments).toHaveBeenCalledWith("source", "target", "event-1"))
    expect(assignSpecialFunction).not.toHaveBeenCalled()
  })

  it("removes a newly assigned Reko role when the transfer fails", async () => {
    const user = userEvent.setup()
    transferRekoAssignments.mockRejectedValueOnce(new Error("transfer failed"))

    renderWithIntl(
      <TransferRekoDialog
        open
        onOpenChange={vi.fn()}
        fromPerson={source}
        rekoPersonnel={[source]}
        onTransferred={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Person als Reko markieren" }))
    await user.click(screen.getByRole("radio", { name: /Neue Reko/ }))
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(unassignSpecialFunction).toHaveBeenCalledWith("event-1", {
      personnel_id: "candidate",
      function_type: "reko",
      vehicle_id: null,
    }))
  })

  it("does not report success when transfer and rollback both fail", async () => {
    const user = userEvent.setup()
    const onTransferred = vi.fn()
    const onOpenChange = vi.fn()
    transferRekoAssignments.mockRejectedValueOnce(new Error("transfer failed"))
    unassignSpecialFunction.mockRejectedValueOnce(new Error("rollback failed"))

    renderWithIntl(
      <TransferRekoDialog
        open
        onOpenChange={onOpenChange}
        fromPerson={source}
        rekoPersonnel={[source]}
        onTransferred={onTransferred}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Person als Reko markieren" }))
    await user.click(screen.getByRole("radio", { name: /Neue Reko/ }))
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(unassignSpecialFunction).toHaveBeenCalledOnce())
    expect(refreshOperations).toHaveBeenCalledOnce()
    expect(onTransferred).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.queryByRole("button", { name: /Neue Reko/ })).not.toBeInTheDocument()
  })
})

const rekoRow = (personnel_id: string, name: string, open_count = 0) => ({
  personnel_id,
  name,
  role: "Wm",
  assignment_count: open_count,
  open_count,
  done_count: 0,
  open_assignments: [],
  distance_m: null,
  distance_source: null,
})

describe("AssignRekoDialog", () => {
  // The Reko already on the Einsatz is the ticked tile; «Übernehmen» on it keeps it –
  // the status gate's way forward – and writes nothing.
  it("keeps the current Reko on «Übernehmen» and assigns another only once ticked", async () => {
    const user = userEvent.setup()
    const onAssigned = vi.fn()
    getAvailableRekoPersonnel.mockResolvedValue({
      personnel: [rekoRow("current", "Reko Jetzt", 1), rekoRow("other", "Reko Anders")],
      currently_assigned_id: "current",
    })

    renderWithIntl(
      <AssignRekoDialog open onOpenChange={vi.fn()} incidentId="incident-1" incidentTitle="Hauptstrasse 1" onAssigned={onAssigned} />,
    )

    const current = await screen.findByRole("radio", { name: /Reko Jetzt/ })
    expect(current).toHaveAttribute("aria-checked", "true")
    expect(current).toHaveTextContent("aktuell")
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))
    expect(onAssigned).toHaveBeenCalledOnce()
    expect(assignRekoPersonnel).not.toHaveBeenCalled()

    await user.click(screen.getByRole("radio", { name: /Reko Anders/ }))
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))
    await waitFor(() => expect(assignRekoPersonnel).toHaveBeenCalledWith("incident-1", "other"))
  })

  it("removes a newly assigned Reko role when assigning the incident fails", async () => {
    const user = userEvent.setup()
    assignRekoPersonnel.mockRejectedValueOnce(new Error("assignment failed"))

    renderWithIntl(
      <AssignRekoDialog
        open
        onOpenChange={vi.fn()}
        incidentId="incident-1"
        incidentTitle="Hauptstrasse 1"
      />,
    )

    await user.click(await screen.findByRole("button", { name: "Person als Reko markieren" }))
    await user.click(screen.getByRole("radio", { name: /Neue Reko/ }))
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(unassignSpecialFunction).toHaveBeenCalledWith("event-1", {
      personnel_id: "candidate",
      function_type: "reko",
      vehicle_id: null,
    }))
  })

  it("does not report success when assignment and rollback both fail", async () => {
    const user = userEvent.setup()
    const onAssigned = vi.fn()
    const onOpenChange = vi.fn()
    assignRekoPersonnel.mockRejectedValueOnce(new Error("assignment failed"))
    unassignSpecialFunction.mockRejectedValueOnce(new Error("rollback failed"))

    renderWithIntl(
      <AssignRekoDialog
        open
        onOpenChange={onOpenChange}
        incidentId="incident-1"
        incidentTitle="Hauptstrasse 1"
        onAssigned={onAssigned}
      />,
    )

    await user.click(await screen.findByRole("button", { name: "Person als Reko markieren" }))
    await user.click(screen.getByRole("radio", { name: /Neue Reko/ }))
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(unassignSpecialFunction).toHaveBeenCalledOnce())
    expect(refreshOperations).toHaveBeenCalledOnce()
    expect(onAssigned).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.queryByRole("button", { name: /Neue Reko/ })).not.toBeInTheDocument()
  })
})

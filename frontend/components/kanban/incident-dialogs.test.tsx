import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Operation } from "@/lib/contexts/operations-context"

const transferAssignments = vi.hoisted(() => vi.fn())
const getIncidents = vi.hoisted(() => vi.fn())
const refreshOperations = vi.hoisted(() => vi.fn())
const operations = vi.hoisted(() => [] as Operation[])
const groups = vi.hoisted(() => [] as { id: string; stopIds: string[] }[])

vi.mock("@/lib/api-client", () => ({ apiClient: { transferAssignments, getIncidents } }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ isEditor: true }) }))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: { id: "event-1" } }) }))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({
    operations,
    materials: [],
    changeStatusToTop: vi.fn(),
    removeMaterial: vi.fn(),
    refreshOperations,
  }),
}))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({
    groups,
    getGroupResources: () => ({ personnel: [], vehicles: [], materials: [] }),
    unassignResource: vi.fn(),
  }),
}))

import { useIncidentDialogs } from "@/components/kanban/incident-dialogs"

const stop = { id: "incident-1", groupId: null, status: "incoming" } as unknown as Operation

beforeEach(() => {
  operations.splice(0, operations.length, stop)
  groups.splice(0, groups.length)
  transferAssignments.mockReset().mockResolvedValue(undefined)
  getIncidents.mockReset().mockResolvedValue([])
  refreshOperations.mockReset().mockResolvedValue(undefined)
})

describe("useIncidentDialogs", () => {
  it("opens the Auftrag's resources for a stop, even before its groupId arrived", () => {
    groups.push({ id: "g1", stopIds: ["incident-1"] })
    const { result } = renderHook(() => useIncidentDialogs())

    act(() => result.current.openAssignment("crew", "incident-1"))

    expect(result.current.assignmentOpen).toBe(true)
    expect(result.current.view.assignment).toMatchObject({ resourceType: "crew", routeGroupId: "g1" })
  })

  it("keeps an incident's own assignment, search included, and drops the route on close", () => {
    const { result } = renderHook(() => useIncidentDialogs())

    act(() => result.current.openAssignment("materials", "incident-1", "Tauchpumpe"))
    expect(result.current.view.assignment).toMatchObject({ operationId: "incident-1", routeGroupId: null, search: "Tauchpumpe" })

    act(() => result.current.view.closeAssignment())
    expect(result.current.assignmentOpen).toBe(false)
  })

  it("transfers, reloads the board and closes – one flow for card menu and detail", async () => {
    const { result } = renderHook(() => useIncidentDialogs())

    await act(() => result.current.openTransfer("incident-1"))
    expect(getIncidents).toHaveBeenCalledWith("event-1")
    expect(result.current.view.transfer?.sourceId).toBe("incident-1")

    await act(() => result.current.view.runTransfer("incident-2"))
    expect(transferAssignments).toHaveBeenCalledWith("incident-1", "incident-2")
    expect(refreshOperations).toHaveBeenCalledOnce()
    expect(result.current.view.transfer).toBeNull()
  })
})

import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useIncidentStatusWorkflow } from "@/components/kanban/incident-status-workflow"
import type { Material, Operation } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"

const emptyGroupResources: GroupResources = { personnel: [], vehicles: [], materials: [] }

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "incident-1",
    location: "Hauptstrasse 1",
    vehicle: null,
    vehicles: [],
    incidentType: "brand",
    dispatchTime: new Date("2026-07-23T10:00:00Z"),
    crew: [],
    priority: "high",
    status: "incoming",
    coordinates: [47.1, 7.2],
    materials: [],
    notes: "Meldung",
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
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  }
}

function renderWorkflow(currentOperation: Operation, groupResources: GroupResources = emptyGroupResources) {
  const changeStatusToTop = vi.fn()
  const getGroupResources = vi.fn(() => groupResources)
  const materials: Material[] = currentOperation.materials.map((id) => ({
    id,
    name: id,
    type: "Material",
    category: "Magazin",
    categorySortOrder: 0,
    status: "assigned",
    consumable: false,
    groupId: null,
  }))
  const result = renderHook(() => useIncidentStatusWorkflow({
    operations: [currentOperation],
    materials,
    changeStatusToTop,
    getGroupResources,
    removeMaterial: vi.fn(),
    unassignGroupResource: vi.fn(),
  }))
  return { ...result, changeStatusToTop }
}

describe("shared incident detail status workflow", () => {
  it("gates enroute requests on missing resources before opening Disponiert", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation())

    act(() => result.current.requestStatusChange("incident-1", "enroute"))

    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "enroute")
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")
    expect(result.current.disponiertOperation).toBeNull()
  })

  it("opens Disponiert directly when all effective resources are present", () => {
    const { result } = renderWorkflow(operation({
      crew: ["AdF Eins"],
      vehicles: ["TLF"],
      materials: ["Schlauch"],
    }))

    act(() => result.current.requestStatusChange("incident-1", "enroute"))

    expect(result.current.missingResourcesOperation).toBeNull()
    expect(result.current.disponiertOperation?.id).toBe("incident-1")
  })

  it("gates Reko, Reko completion, return, and incident completion requests", () => {
    const reko = renderWorkflow(operation())
    act(() => reko.result.current.requestStatusChange("incident-1", "ready"))
    expect(reko.result.current.rekoMissingOperation?.id).toBe("incident-1")

    const rekoDone = renderWorkflow(operation())
    act(() => rekoDone.result.current.requestStatusChange("incident-1", "rekoDone"))
    expect(rekoDone.result.current.rekoFormMissingOperation?.id).toBe("incident-1")

    const returning = renderWorkflow(operation())
    act(() => returning.result.current.requestStatusChange("incident-1", "returning"))
    expect(returning.result.current.returningVehicleOperation?.id).toBe("incident-1")

    const complete = renderWorkflow(operation({ materials: ["material-1"] }))
    act(() => complete.result.current.requestCompletion("incident-1"))
    expect(complete.changeStatusToTop).toHaveBeenCalledWith("incident-1", "complete")
    expect(complete.result.current.materialDecisionOperation?.id).toBe("incident-1")
  })

  it("reverts to the pre-dispatch status when the missing-resource gate is cancelled", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "ready" }))

    act(() => result.current.requestStatusChange("incident-1", "enroute"))
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "enroute")
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")

    act(() => result.current.cancelMissingResources())
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "ready")
    expect(result.current.missingResourcesOperation).toBeNull()
  })

  it("keeps the cancel return status across the assignment suspend/resume round-trip", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation())

    act(() => result.current.requestStatusChange("incident-1", "enroute"))
    act(() => result.current.suspendGateForAssignment("missing", "incident-1"))
    act(() => result.current.resumeGateAfterAssignment())
    act(() => result.current.cancelMissingResources())

    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "incoming")
    expect(result.current.missingResourcesOperation).toBeNull()
  })

  it("cancel only closes the gate when no return status is known", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation())

    act(() => result.current.triggerDisponiertDialog("incident-1"))
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")

    act(() => result.current.cancelMissingResources())
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.missingResourcesOperation).toBeNull()
  })

  it("returns to the missing-resource gate after its assignment dialog closes", () => {
    const { result } = renderWorkflow(operation())
    act(() => result.current.requestStatusChange("incident-1", "enroute"))
    act(() => result.current.suspendGateForAssignment("missing", "incident-1"))
    expect(result.current.missingResourcesOperation).toBeNull()

    act(() => result.current.resumeGateAfterAssignment())
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")
  })
})

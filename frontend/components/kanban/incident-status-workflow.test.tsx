import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useIncidentStatusWorkflow } from "@/components/kanban/incident-status-workflow"
import type { Material, Operation } from "@/lib/contexts/operations-context"
import type { GroupResources } from "@/lib/types/groups"

// The material gate prefills itself from the Schadenplatz-Rapport. Every gate
// test opens one, so the door has to be mocked for all of them, not just the
// prefill cases. Resolving the gate writes the confirmed answers back through
// the second door, so that one is mocked alongside.
const getRapportMaterialReturn = vi.hoisted(() => vi.fn())
const applyRapportMaterialDecisions = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api-client", () => ({ apiClient: { getRapportMaterialReturn, applyRapportMaterialDecisions } }))

const emptyGroupResources: GroupResources = { personnel: [], vehicles: [], materials: [] }

function rapport(overrides: Partial<{
  returned: unknown[]
  left_on_site: unknown[]
  rapport_by: string | null
  rapport_is_draft: boolean
}> = {}) {
  return {
    returned: [],
    left_on_site: [],
    rapport_by: null,
    rapport_submitted_at: null,
    rapport_is_draft: false,
    ...overrides,
  }
}

beforeEach(() => {
  getRapportMaterialReturn.mockReset()
  getRapportMaterialReturn.mockResolvedValue(rapport())
  applyRapportMaterialDecisions.mockReset()
  applyRapportMaterialDecisions.mockResolvedValue({ applied: true })
})

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
    leaderName: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  }
}

function renderWorkflow(
  currentOperation: Operation,
  groupResources: GroupResources = emptyGroupResources,
  groups: { id: string; stopIds: string[] }[] = [],
  consumableIds: string[] = [],
  /** The other stops of the route, when the test is about one. */
  siblings: Operation[] = [],
) {
  const changeStatusToTop = vi.fn()
  const getGroupResources = vi.fn(() => groupResources)
  const materials: Material[] = currentOperation.materials.map((id) => ({
    id,
    name: id,
    type: "Material",
    category: "Magazin",
    categorySortOrder: 0,
    status: "assigned",
    outOfService: false,
    outOfServiceSince: null,
    consumable: consumableIds.includes(id),
    groupId: null,
  }))
  const removeMaterial = vi.fn()
  const unassignGroupResource = vi.fn()
  const result = renderHook(() => useIncidentStatusWorkflow({
    operations: [currentOperation, ...siblings],
    materials,
    groups: groups as never,
    changeStatusToTop,
    getGroupResources,
    removeMaterial,
    unassignGroupResource,
  }))
  return { ...result, changeStatusToTop, removeMaterial, unassignGroupResource }
}

describe("shared incident detail status workflow", () => {
  it("counts the Auftrag's crew for a stop whose groupId has not arrived yet", () => {
    // «+ Stop» writes the route; the incident's own group_id follows on the next
    // refresh. In that window the gate saw no crew and «es fehlt noch etwas»
    // opened for an Auftrag that was fully staffed.
    const stop = operation({ id: "incident-1", groupId: null })
    const routeCrew: GroupResources = {
      personnel: [{ assignmentId: "a1", resourceId: "p1", name: "Roth Til" }],
      vehicles: [{ assignmentId: "a2", resourceId: "v1", name: "TLF" }],
      materials: [{ assignmentId: "a3", resourceId: "m1", name: "Motorsäge" }],
    }

    const blind = renderWorkflow(stop, routeCrew, [])
    expect(blind.result.current.getMissingResources(stop)).toEqual(["crew", "vehicles", "materials"])

    const seeing = renderWorkflow(stop, routeCrew, [{ id: "g1", stopIds: ["incident-1"] }])
    expect(seeing.result.current.getMissingResources(stop)).toEqual([])
  })

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
    act(() => reko.result.current.requestStatusChange("incident-1", "reko"))
    expect(reko.result.current.rekoMissingOperation?.id).toBe("incident-1")

    const rekoDone = renderWorkflow(operation())
    act(() => rekoDone.result.current.requestStatusChange("incident-1", "reko_done"))
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
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko" }))

    act(() => result.current.requestStatusChange("incident-1", "enroute"))
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "enroute")
    expect(result.current.missingResourcesOperation?.id).toBe("incident-1")

    act(() => result.current.cancelMissingResources())
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "reko")
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

  it("reverts to the previous status when the returning-vehicle gate is cancelled", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko_done" }))

    act(() => result.current.requestStatusChange("incident-1", "returning"))
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "returning")
    expect(result.current.returningVehicleOperation?.id).toBe("incident-1")

    act(() => result.current.cancelReturningVehicle())
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "reko_done")
    expect(result.current.returningVehicleOperation).toBeNull()
  })

  it("keeps the returning-vehicle return status across the assignment suspend/resume round-trip", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko_done" }))

    act(() => result.current.requestStatusChange("incident-1", "returning"))
    act(() => result.current.suspendGateForAssignment("returning", "incident-1"))
    expect(result.current.returningVehicleOperation).toBeNull()

    // Resume re-triggers WITHOUT previousStatus — the stored return status must survive.
    act(() => result.current.resumeGateAfterAssignment())
    expect(result.current.returningVehicleOperation?.id).toBe("incident-1")

    act(() => result.current.cancelReturningVehicle())
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "reko_done")
    expect(result.current.returningVehicleOperation).toBeNull()
  })

  it("reverts on cancel in the Reko gates", () => {
    const reko = renderWorkflow(operation({ status: "enroute" }))
    act(() => reko.result.current.requestStatusChange("incident-1", "reko"))
    act(() => reko.result.current.cancelRekoMissing())
    expect(reko.changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "enroute")
    expect(reko.result.current.rekoMissingOperation).toBeNull()

    const rekoForm = renderWorkflow(operation({ status: "reko" }))
    act(() => rekoForm.result.current.requestStatusChange("incident-1", "reko_done"))
    act(() => rekoForm.result.current.cancelRekoFormMissing())
    expect(rekoForm.changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "reko")
    expect(rekoForm.result.current.rekoFormMissingOperation).toBeNull()
  })

  it("reverts the status and discards local decisions when the material decision is cancelled", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "returning", materials: ["material-1"] }))

    act(() => result.current.requestCompletion("incident-1"))
    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "complete")
    expect(result.current.materialDecisionOperation?.id).toBe("incident-1")

    act(() => result.current.setMaterialDecision("material-1", "vorort"))
    expect(result.current.materialDecisions["material-1"]).toBe("vorort")

    act(() => result.current.cancelMaterialDecision())
    expect(changeStatusToTop).toHaveBeenLastCalledWith("incident-1", "returning")
    expect(result.current.materialDecisionOperation).toBeNull()
    expect(result.current.materialDecisions).toEqual({})
  })

  it("cancel in the post-change gates only closes when no return status is known", () => {
    const { result, changeStatusToTop } = renderWorkflow(operation({ status: "reko_done" }))

    act(() => result.current.triggerReturningVehicleCheck("incident-1"))
    expect(result.current.returningVehicleOperation?.id).toBe("incident-1")

    act(() => result.current.cancelReturningVehicle())
    expect(changeStatusToTop).not.toHaveBeenCalled()
    expect(result.current.returningVehicleOperation).toBeNull()
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

describe("the material gate takes the crew's word for it", () => {
  // The crew answered "vor Ort oder ins Magazin" per unit at the Schadenplatz.
  // Asking the operator the same question from scratch at completion asks
  // somebody who was not there to overrule somebody who was.

  const unit = (id: string, extra: Record<string, unknown> = {}) => ({
    assignment_id: `a-${id}`,
    material_id: id,
    name: id,
    location: null,
    used: true,
    answered: true,
    ...extra,
  })

  it("prefills every unit the rapport answered, attributed to its author", async () => {
    getRapportMaterialReturn.mockResolvedValue(rapport({
      returned: [unit("pumpe")],
      left_on_site: [unit("nasssauger")],
      rapport_by: "Muster Hans",
    }))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe", "nasssauger"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    const byId = Object.fromEntries(result.current.materialDecisionItems.map((item) => [item.id, item]))
    expect(result.current.materialChoice(byId.pumpe)).toBe("magazin")
    expect(result.current.materialChoice(byId.nasssauger)).toBe("vorort")
    // Nothing left to decide: the dialog is a confirmation, not a questionnaire.
    expect(result.current.materialDecisionOpenCount).toBe(0)
    expect(byId.pumpe.source).toBe("rapport")
  })

  it("still asks about the units the rapport did not answer", async () => {
    // `returned` also carries what nobody looked at — an unanswered row defaults
    // to "not left on site". Treating that as an answer would put words in the
    // crew's mouth about a unit it never saw.
    getRapportMaterialReturn.mockResolvedValue(rapport({
      returned: [unit("pumpe"), unit("leiter", { answered: false })],
      rapport_by: "Muster Hans",
    }))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe", "leiter"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    const byId = Object.fromEntries(result.current.materialDecisionItems.map((item) => [item.id, item]))
    expect(byId.pumpe.source).toBe("rapport")
    expect(byId.leiter.source).toBeNull()
    expect(result.current.materialDecisionOpenCount).toBe(1)
  })

  it("never treats a consumable as an open question", async () => {
    // A consumable has no "vor Ort" state at all (decision 26), so the rapport
    // does not carry one and the gate must not ask for one.
    const { result } = renderWorkflow(
      operation({ status: "returning", materials: ["oelbinder"] }),
      emptyGroupResources,
      [],
      ["oelbinder"],
    )

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialDecisionItems).toHaveLength(1))

    const [item] = result.current.materialDecisionItems
    expect(item.consumable).toBe(true)
    expect(item.source).toBe("consumable")
    expect(result.current.materialChoice(item)).toBe("magazin")
    expect(result.current.materialDecisionOpenCount).toBe(0)
  })

  it("an operator click overrules the rapport", async () => {
    getRapportMaterialReturn.mockResolvedValue(rapport({
      left_on_site: [unit("pumpe")],
      rapport_by: "Muster Hans",
    }))
    const { result, removeMaterial } = renderWorkflow(
      operation({ status: "returning", materials: ["pumpe"] }),
    )

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))
    act(() => result.current.setMaterialDecision("pumpe", "magazin"))

    let resolved: { returned: string[]; kept: string[] } | undefined
    act(() => {
      resolved = result.current.resolveMaterialDecision()
    })
    expect(resolved).toEqual({ returned: ["pumpe"], kept: [] })
    expect(removeMaterial).toHaveBeenCalledWith("incident-1", "pumpe")
  })

  it("releases what the rapport sent back without a single click", async () => {
    getRapportMaterialReturn.mockResolvedValue(rapport({
      returned: [unit("pumpe")],
      left_on_site: [unit("nasssauger")],
      rapport_by: "Muster Hans",
    }))
    const { result, removeMaterial } = renderWorkflow(
      operation({ status: "returning", materials: ["pumpe", "nasssauger"] }),
    )

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    let resolved: { returned: string[]; kept: string[] } | undefined
    act(() => {
      resolved = result.current.resolveMaterialDecision()
    })
    expect(resolved).toEqual({ returned: ["pumpe"], kept: ["nasssauger"] })
    expect(removeMaterial).toHaveBeenCalledExactlyOnceWith("incident-1", "pumpe")
  })

  it("prefills from a DRAFT rapport, and says that it is one (§18.23)", async () => {
    // The bug: a crew fills the checklist on /feld and never presses "Rapport
    // abschliessen" — on a phone, in the rain, that is the normal case. The
    // gate used to throw those answers away and ask the operator from scratch.
    // `left_on_site: true` is the crew saying where a unit stays; since §18.32
    // `used` has no third value, so an answered draft row is one that
    // contradicts the prefill.
    getRapportMaterialReturn.mockResolvedValue(rapport({
      left_on_site: [unit("pumpe", { answered: true })],
      rapport_by: "Muster Hans",
      rapport_is_draft: true,
    }))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(result.current.materialRapportBy).toBe("Muster Hans"))

    const [item] = result.current.materialDecisionItems
    expect(result.current.materialChoice(item)).toBe("vorort")
    expect(result.current.materialDecisionOpenCount).toBe(0)
    // The operator has to be able to weigh a half-finished answer.
    expect(result.current.materialRapportIsDraft).toBe(true)
  })

  it("calls the gate's own door — the release list must not read drafts", async () => {
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))
    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() =>
      expect(getRapportMaterialReturn).toHaveBeenCalledWith("incident-1", { includeDraft: true }),
    )
  })

  it("asks from scratch when no rapport was submitted", async () => {
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(getRapportMaterialReturn).toHaveBeenCalledWith("incident-1", { includeDraft: true }))

    expect(result.current.materialRapportBy).toBeNull()
    expect(result.current.materialDecisionOpenCount).toBe(1)
    expect(result.current.materialDecisionItems[0].source).toBeNull()
  })

  it("asks nothing about material while the Auftrag still has stops ahead", async () => {
    // The squad is not driving back to the Magazin, it is driving to the next
    // stop — «vor Ort oder ins Magazin?» offers two answers that are both
    // wrong. The route's Geräte must also survive the gate untouched.
    const routeMaterial: GroupResources = {
      personnel: [],
      vehicles: [],
      materials: [{ assignmentId: "a1", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const { result, unassignGroupResource } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", crew: ["AdF Eins"] }),
      routeMaterial,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestCompletion("stop-1"))

    // The gate still opens — the stop's own crew is handed back and that has to
    // be named — but it is a «Stopp abschliessen», with the next stop on it.
    expect(result.current.materialDecisionOperation?.id).toBe("stop-1")
    expect(result.current.completionContinuation?.next.id).toBe("stop-2")
    expect(result.current.materialDecisionItems).toEqual([])

    let resolved: { returned: string[]; kept: string[] } | undefined
    act(() => {
      resolved = result.current.resolveMaterialDecision()
    })
    expect(resolved).toEqual({ returned: [], kept: [] })
    expect(unassignGroupResource).not.toHaveBeenCalled()
    expect(applyRapportMaterialDecisions).not.toHaveBeenCalled()
  })

  it("opens for a mid-route stop that hands nothing back, because the route is the subject", () => {
    // The standard Auftrag: crew, vehicles and Geräte belong to the ROUTE, so
    // a stop releases nothing at all. The gate used to return early on exactly
    // that shape — which made «Weiter zu: …» and the offer to start the next
    // stop invisible on the routes they were built for.
    const routeResources: GroupResources = {
      personnel: [{ assignmentId: "a0", resourceId: "p1", name: "Roth Til" }],
      vehicles: [{ assignmentId: "a1", resourceId: "v1", name: "TLF" }],
      materials: [{ assignmentId: "a2", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const { result } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning" }),
      routeResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestCompletion("stop-1"))

    expect(result.current.materialDecisionOperation?.id).toBe("stop-1")
    // Nothing to list and nothing to decide — the dialog carries the route
    // alone, which is why its description must not promise a release list.
    expect(result.current.completionRelease).toBeNull()
    expect(result.current.materialDecisionItems).toEqual([])
    expect(result.current.completionContinuation?.next.id).toBe("stop-2")
    expect(result.current.completionNextStop?.id).toBe("stop-2")
  })

  it("stays shut when nothing is released and no stop can be started", () => {
    const routeResources: GroupResources = {
      personnel: [{ assignmentId: "a0", resourceId: "p1", name: "Roth Til" }],
      vehicles: [],
      materials: [],
    }

    // The squad is already working another stop of the route, so there is
    // nothing to offer — and with an empty release list, nothing to say.
    const busy = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning" }),
      routeResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "active" })],
    )
    act(() => busy.result.current.requestCompletion("stop-1"))
    expect(busy.result.current.materialDecisionOperation).toBeNull()

    // The last stop of a route with no material of its own: an Abschluss that
    // hands nothing back is still a one-gesture move.
    const lastStop = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "returning" }),
      routeResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )
    act(() => lastStop.result.current.requestCompletion("stop-2"))
    expect(lastStop.result.current.materialDecisionOperation).toBeNull()

    // …and an incident that belongs to no Auftrag at all.
    const lone = renderWorkflow(operation({ status: "returning" }))
    act(() => lone.result.current.requestCompletion("incident-1"))
    expect(lone.result.current.materialDecisionOperation).toBeNull()
  })

  it("asks about the route's material once the last open stop closes", async () => {
    const routeMaterial: GroupResources = {
      personnel: [],
      vehicles: [],
      materials: [{ assignmentId: "a1", resourceId: "motorsaege", name: "Motorsäge" }],
    }
    const { result, unassignGroupResource } = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "returning" }),
      routeMaterial,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )

    act(() => result.current.requestCompletion("stop-2"))
    await waitFor(() => expect(result.current.materialDecisionItems).toHaveLength(1))
    expect(result.current.completionContinuation).toBeNull()

    act(() => {
      result.current.resolveMaterialDecision()
    })
    expect(unassignGroupResource).toHaveBeenCalledWith("g1", "a1")
  })

  it("offers the next stop from the completion gate, and starts the one it named", () => {
    // Dragging a stop straight to «Abgeschlossen» skips the «Nächsten Stopp
    // starten?» prompt, which only fires on the way through «Beendet». The gate
    // already NAMES the next stop, so it carries the same offer.
    const { result, changeStatusToTop } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", crew: ["AdF Eins"] }),
      emptyGroupResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestCompletion("stop-1"))
    expect(result.current.completionNextStop?.id).toBe("stop-2")
    // The offer names exactly the stop the dialog prints as «Weiter zu: …».
    expect(result.current.completionNextStop?.id).toBe(result.current.completionContinuation?.next.id)

    act(() => result.current.startNextStop("stop-2"))
    expect(changeStatusToTop).toHaveBeenLastCalledWith("stop-2", "active")
  })

  it("offers nothing on the last stop, on a lone incident, or while the squad is working", () => {
    const lastStop = renderWorkflow(
      operation({ id: "stop-2", groupId: "g1", status: "returning", crew: ["AdF Eins"] }),
      emptyGroupResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-1", groupId: "g1", status: "complete" })],
    )
    act(() => lastStop.result.current.requestCompletion("stop-2"))
    expect(lastStop.result.current.completionContinuation).toBeNull()
    expect(lastStop.result.current.completionNextStop).toBeNull()

    const lone = renderWorkflow(operation({ status: "returning", crew: ["AdF Eins"] }))
    act(() => lone.result.current.requestCompletion("incident-1"))
    expect(lone.result.current.completionNextStop).toBeNull()

    // The route continues, so the gate is still a «Stopp abschliessen» — but
    // another stop is already in Einsatz, so there is nothing to send anybody to.
    const busy = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "returning", crew: ["AdF Eins"] }),
      emptyGroupResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2", "stop-3"] }],
      [],
      [
        operation({ id: "stop-2", groupId: "g1", status: "active" }),
        operation({ id: "stop-3", groupId: "g1", status: "incoming" }),
      ],
    )
    act(() => busy.result.current.requestCompletion("stop-1"))
    expect(busy.result.current.completionContinuation?.next.id).toBe("stop-2")
    expect(busy.result.current.completionNextStop).toBeNull()
  })

  it("keeps offering the same stop from the «Beendet» prompt", () => {
    // The other half of the pair: both offers read one rule, so a stop finished
    // either way sends the squad to the same place.
    const { result, changeStatusToTop } = renderWorkflow(
      operation({ id: "stop-1", groupId: "g1", status: "active", zuFuss: true }),
      emptyGroupResources,
      [{ id: "g1", stopIds: ["stop-1", "stop-2"] }],
      [],
      [operation({ id: "stop-2", groupId: "g1", status: "incoming" })],
    )

    act(() => result.current.requestStatusChange("stop-1", "returning"))
    expect(result.current.nextStopPrompt?.next.id).toBe("stop-2")

    act(() => result.current.startNextStop("stop-2"))
    expect(changeStatusToTop).toHaveBeenLastCalledWith("stop-2", "active")
    expect(result.current.nextStopPrompt).toBeNull()
  })

  it("falls back to asking when the rapport cannot be read", async () => {
    getRapportMaterialReturn.mockRejectedValue(new Error("offline"))
    const { result } = renderWorkflow(operation({ status: "returning", materials: ["pumpe"] }))

    act(() => result.current.requestCompletion("incident-1"))
    await waitFor(() => expect(getRapportMaterialReturn).toHaveBeenCalledWith("incident-1", { includeDraft: true }))

    expect(result.current.materialDecisionOperation?.id).toBe("incident-1")
    expect(result.current.materialRapportBy).toBeNull()
    expect(result.current.materialDecisionOpenCount).toBe(1)
  })
})

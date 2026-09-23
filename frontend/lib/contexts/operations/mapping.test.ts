import { describe, expect, it } from "vitest"
import type { ApiEventRestliste, ApiIncident } from "@/lib/api-client"
import { apiIncidentToOperation, rekoDangerTypes, toMaterialOnSite } from "./mapping"

// The board-load golden (operations-context.snapshot.test.tsx) pins the same
// mapping through the provider; this pins the function on its own.

const incident = (overrides: Partial<ApiIncident> = {}): ApiIncident =>
  ({
    id: "inc-1",
    event_id: "evt-1",
    title: "Wasser im Keller",
    type: "technische_hilfeleistung",
    priority: "high",
    location_address: "Hauptstrasse 12, 4104 Oberwil",
    location_display: "Hauptstrasse 12",
    location_lat: "47.5150",
    location_lng: "7.5560",
    status: "enroute",
    position: 0,
    group_id: "grp-1",
    group_position: 3,
    source: "intake",
    from_real_alarm: true,
    description: "Keller",
    contact: "Frau Muster",
    contact_phone: "061",
    internal_notes: "Hund",
    nachbarhilfe: true,
    nachbarhilfe_note: "hilft",
    am_warten: false,
    am_warten_note: null,
    zu_fuss: false,
    created_at: "2026-09-23T08:00:00Z",
    updated_at: "2026-09-23T08:30:00Z",
    created_by: null,
    completed_at: null,
    status_changed_at: "2026-09-23T08:20:00Z",
    assigned_vehicles: [],
    has_completed_reko: true,
    reko_arrived_at: null,
    field_complete_reported_at: null,
    leader_name: "Beat",
    ...overrides,
  }) as ApiIncident

describe("apiIncidentToOperation", () => {
  it("carries the incident's own fields onto the card", () => {
    const op = apiIncidentToOperation(incident())
    expect(op).toMatchObject({
      id: "inc-1",
      location: "Hauptstrasse 12, 4104 Oberwil",
      locationDisplay: "Hauptstrasse 12",
      incidentType: "technische_hilfeleistung",
      priority: "high",
      status: "enroute",
      coordinates: [47.515, 7.556],
      notes: "Keller",
      contact: "Frau Muster",
      contactPhone: "061",
      internalNotes: "Hund",
      nachbarhilfe: true,
      nachbarhilfeNote: "hilft",
      groupId: "grp-1",
      groupPosition: 3,
      source: "intake",
      fromRealAlarm: true,
      hasCompletedReko: true,
      leaderName: "Beat",
    })
    expect(op.dispatchTime).toEqual(new Date("2026-09-23T08:00:00Z"))
    expect(op.statusChangedAt).toEqual(new Date("2026-09-23T08:20:00Z"))
  })

  it("starts every card empty of resources — the load folds those in", () => {
    const op = apiIncidentToOperation(incident())
    expect(op).toMatchObject({ vehicle: null, vehicles: [], crew: [], materials: [], rekoSummary: null, assignedReko: null })
    for (const map of [op.crewAssignments, op.materialAssignments, op.vehicleAssignments, op.vehicleCallsigns, op.vehicleDriverStay]) {
      expect(map).toEqual(new Map())
    }
  })

  it("falls back where the API sends nothing", () => {
    const op = apiIncidentToOperation(
      incident({
        location_address: null,
        location_display: undefined,
        type: "" as ApiIncident["type"],
        source: "",
        description: null,
        location_lng: null,
        from_real_alarm: undefined,
        leader_name: undefined,
        group_id: undefined as unknown as null,
        group_position: undefined as unknown as number,
      }),
    )
    expect(op.location).toBe("Wasser im Keller")
    expect(op.locationDisplay).toBeUndefined()
    expect(op.incidentType).toBe("elementarereignis")
    expect(op.source).toBe("operator")
    expect(op.notes).toBe("")
    expect(op.coordinates).toBeNull()
    expect(op.fromRealAlarm).toBe(false)
    expect(op.leaderName).toBeNull()
    expect(op.groupId).toBeNull()
    expect(op.groupPosition).toBe(0)
  })
})

describe("toMaterialOnSite", () => {
  it("indexes the Restliste's tracked material by id, address first, title second", () => {
    const map = toMaterialOnSite({
      material_on_site: [
        { material_id: "m-1", incident_id: "i-1", location_address: "Hauptstrasse 12", incident_title: "Keller", since: "2026-09-23T09:00:00Z" },
        { material_id: "m-2", incident_id: "i-2", location_address: null, incident_title: "Baum", since: null },
        { material_id: "m-3", incident_id: "i-3", location_address: null, incident_title: null, since: null },
        { material_id: null, incident_id: "i-1", location_address: null, incident_title: null, since: null },
      ],
    } as unknown as ApiEventRestliste)
    expect(map).toEqual(
      new Map([
        ["m-1", { incidentId: "i-1", address: "Hauptstrasse 12", since: "2026-09-23T09:00:00Z" }],
        ["m-2", { incidentId: "i-2", address: "Baum", since: null }],
        ["m-3", { incidentId: "i-3", address: null, since: null }],
      ]),
    )
  })

  it("is empty without a Restliste", () => {
    expect(toMaterialOnSite(null)).toEqual(new Map())
  })
})

describe("rekoDangerTypes (re-exported by the context)", () => {
  it("keeps the old `fire` flag and reads in the form's order", () => {
    expect(
      rekoDangerTypes({ fire: true, fire_danger: true, explosion: true, collapse: false, chemical: true, electrical: false }),
    ).toEqual(["Feuer", "Brandgefahr", "Explosion", "Gefahrstoffe"])
  })
})

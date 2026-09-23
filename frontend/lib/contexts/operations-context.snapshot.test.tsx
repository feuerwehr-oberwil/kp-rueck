import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useState, type ReactNode } from "react"

import type { ApiIncident } from "@/lib/api-client"

// The board's snapshot, golden: one fully populated incident and one bare one,
// run through the provider's load with every fetch answered, and the resulting
// cards, roster and depot compared field by field. This is what the board
// draws — the API → Operation mapping and the event-scoped reconciliation
// (crew, Reko, leader, vehicle order, danger chips, availability) — pinned
// before either is moved out of the provider.

const EVENT = "11111111-1111-1111-1111-111111111111"

// --- Mocks (same harness as operations-context.sync.test.tsx) -----------------

const authState = vi.hoisted(() => ({ isAuthenticated: true, loading: false }))
const eventState = vi.hoisted(() => ({
  selectedEvent: { id: "11111111-1111-1111-1111-111111111111" } as { id: string },
  isEventLoaded: true,
}))
vi.mock("./auth-context", () => ({ useAuth: () => authState }))
vi.mock("./event-context", () => ({ useEvent: () => eventState }))

const refreshPersonnel = vi.hoisted(() => vi.fn())
const refreshMaterials = vi.hoisted(() => vi.fn())
vi.mock("./personnel-context", () => ({
  usePersonnel: () => {
    const [personnel, setPersonnel] = useState<unknown[]>([])
    return { personnel, setPersonnel, refreshPersonnel }
  },
}))
vi.mock("./materials-context", () => ({
  useMaterials: () => {
    const [materials, setMaterials] = useState<unknown[]>([])
    return { materials, setMaterials, refreshMaterials }
  },
}))
vi.mock("@/lib/websocket-client", () => ({
  wsClient: {
    on: () => () => {},
    onStatusChange: () => () => {},
    getStatus: () => "connected",
    connect: () => {},
    disconnect: () => {},
  },
}))
vi.mock("@/components/ui/top-loading-bar", () => ({ topLoading: { start: () => {}, done: () => {} } }))

const api = vi.hoisted(() => ({
  getSyncVersion: vi.fn(),
  getIncidentsWithTotal: vi.fn(),
  getAllSettings: vi.fn(),
  getVehicles: vi.fn(),
  getEventRestliste: vi.fn(),
  getEventSpecialFunctions: vi.fn(),
  getAssignmentsByEvent: vi.fn(),
  getEventRekoSummaries: vi.fn(),
}))
vi.mock("@/lib/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api-client")>()),
  apiClient: api,
}))

import { OperationsProvider, useOperations } from "./operations-context"

const wrapper = ({ children }: { children: ReactNode }) => <OperationsProvider>{children}</OperationsProvider>

// --- Fixture ------------------------------------------------------------------

const FULL: ApiIncident = {
  id: "inc-full",
  event_id: EVENT,
  title: "Wasser im Keller",
  type: "elementarereignis",
  priority: "high",
  location_address: "Hauptstrasse 12, 4104 Oberwil",
  location_display: "Hauptstrasse 12",
  location_lat: "47.5150",
  location_lng: "7.5560",
  status: "active",
  position: 0,
  group_id: "grp-1",
  group_position: 2,
  source: "feld",
  from_real_alarm: true,
  description: "Keller 20 cm",
  contact: "Frau Muster",
  contact_phone: "+41 61 000 00 00",
  internal_notes: "Hund im Haus",
  nachbarhilfe: true,
  nachbarhilfe_note: "Nachbar hilft pumpen",
  am_warten: true,
  am_warten_note: "wartet auf Pumpe",
  zu_fuss: true,
  created_at: "2026-09-23T08:00:00Z",
  updated_at: "2026-09-23T08:30:00Z",
  created_by: null,
  completed_at: null,
  status_changed_at: "2026-09-23T08:20:00Z",
  assigned_vehicles: [],
  has_completed_reko: false,
  reko_arrived_at: "2026-09-23T08:10:00Z",
  reko_arrived_by_kp: true,
  field_complete_reported_at: "2026-09-23T08:40:00Z",
  field_complete_reported_by: "p-crew",
  field_arrived_at: "2026-09-23T08:25:00Z",
  field_arrived_by: null,
  field_arrived_by_automation: true,
  has_schadenplatz_rapport: true,
  has_schadenplatz_rapport_draft: false,
  has_been_dispatched: true,
  pickup_needed: true,
  pickup_note: "4 Personen",
  pickup_requested_at: "2026-09-23T08:45:00Z",
  pickup_requested_by: "p-crew",
  leader_name: "Leader of record",
}

/** The shape an older backend (or a bare row) sends: every optional absent. */
const BARE = {
  id: "inc-bare",
  event_id: EVENT,
  title: "Baum auf Strasse",
  type: "",
  priority: "low",
  location_address: null,
  location_lat: "47.5",
  location_lng: null,
  status: "incoming",
  position: 1,
  group_id: null,
  group_position: 0,
  source: "",
  description: null,
  contact: null,
  contact_phone: null,
  internal_notes: null,
  nachbarhilfe: false,
  nachbarhilfe_note: null,
  am_warten: false,
  am_warten_note: null,
  zu_fuss: false,
  created_at: "2026-09-23T09:00:00Z",
  updated_at: "2026-09-23T09:00:00Z",
  created_by: null,
  completed_at: null,
  status_changed_at: null,
  assigned_vehicles: [],
  has_completed_reko: false,
  reko_arrived_at: null,
  field_complete_reported_at: null,
} as unknown as ApiIncident

const person = (id: string, name: string) => ({ id, name, role: "AdF", status: "available", roleSortOrder: 0 })
const PERSONNEL = [
  person("p-crew", "Anna Crew"),
  person("p-lead", "Beat Leader"),
  person("p-reko", "Claudia Reko"),
  person("p-driver", "Dario Driver"),
  person("p-mag", "Eva Magazin"),
  person("p-tel", "Fritz Telefon"),
  person("p-kp", "Gina KP"),
  person("p-other", "Hans Other"),
  person("p-free", "Ida Free"),
]

const material = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  category: "Depot",
  type: "Pumpe",
  status: "available",
  outOfService: false,
  outOfServiceSince: null,
  categorySortOrder: 0,
  consumable: false,
  groupId: null,
  ...extra,
})
const MATERIALS = [
  material("m-pump", "Tauchpumpe"),
  material("m-saw", "Motorsäge", { status: "assigned" }),
  material("m-broken", "Stromerzeuger", { outOfService: true, outOfServiceSince: "2026-09-01T00:00:00Z" }),
]

const vehicle = (id: string, name: string, display_order: number, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  type: "TLF",
  status: "available",
  display_order,
  radio_call_sign: null,
  out_of_service: false,
  ...extra,
})
const VEHICLES = [
  vehicle("v-tlf", "TLF", 1, { radio_call_sign: "Omega 1" }),
  vehicle("v-mtw", "MTW", 2),
  vehicle("v-dlk", "DLK", 3, { out_of_service: true }),
]

const SPECIAL_FUNCTIONS = [
  { personnel_id: "p-reko", function_type: "reko" },
  { personnel_id: "p-driver", function_type: "driver", vehicle_id: "v-tlf", vehicle_name: "TLF" },
  { personnel_id: "p-mag", function_type: "magazin" },
  { personnel_id: "p-tel", function_type: "telefondienst" },
  { personnel_id: "p-kp", function_type: "kommandoposten" },
  { personnel_id: "p-other", function_type: "sonstiges" },
]

const assignment = (id: string, resource_type: string, resource_id: string, extra: Record<string, unknown> = {}) => ({
  id,
  resource_type,
  resource_id,
  is_leader: false,
  driver_stay: false,
  ...extra,
})
const ASSIGNMENTS = {
  "inc-full": [
    assignment("a-crew", "personnel", "p-crew"),
    assignment("a-lead", "personnel", "p-lead", { is_leader: true }),
    // The Reko officer's row makes them the card's Reko, not crew.
    assignment("a-reko", "personnel", "p-reko"),
    // Assigned out of display order: the card must show TLF before MTW.
    assignment("a-mtw", "vehicle", "v-mtw"),
    assignment("a-tlf", "vehicle", "v-tlf", { driver_stay: true }),
    assignment("a-pump", "material", "m-pump"),
    // Rows pointing at nothing known are dropped, not drawn.
    assignment("a-ghost-p", "personnel", "p-gone"),
    assignment("a-ghost-v", "vehicle", "v-gone"),
  ],
}

const REKO_SUMMARIES = {
  summaries: {
    "inc-full": {
      incident_id: "inc-full",
      has_completed_reko: true,
      arrived_at: null,
      is_relevant: true,
      dangers_json: { fire: false, fire_danger: true, explosion: false, collapse: true, chemical: false, electrical: true, other_notes: "x" },
      effort_json: { personnel_count: 4, estimated_duration_hours: 2 },
      summary_text: "Pumpen nötig",
      photos_json: ["a.jpg"],
      submitted_at: null,
      submitted_by_personnel_name: null,
    },
    // A summary without a completed Reko changes nothing.
    "inc-bare": {
      incident_id: "inc-bare",
      has_completed_reko: false,
      arrived_at: null,
      is_relevant: null,
      dangers_json: null,
      effort_json: null,
      summary_text: null,
      photos_json: [],
      submitted_at: null,
      submitted_by_personnel_name: null,
    },
  },
  total: 2,
}

const RESTLISTE = {
  material_on_site: [
    { material_id: "m-pump", incident_id: "inc-full", location_address: "Hauptstrasse 12", incident_title: "Wasser im Keller", since: "2026-09-23T09:00:00Z" },
    { material_id: "m-saw", incident_id: "inc-full", location_address: null, incident_title: "Wasser im Keller", since: null },
    // Hand-named material has no id and no sidebar row.
    { material_id: null, incident_id: "inc-full", location_address: null, incident_title: null, since: null },
  ],
}

beforeEach(() => {
  api.getSyncVersion.mockReset().mockResolvedValue({ version: "v1" })
  api.getIncidentsWithTotal.mockReset().mockResolvedValue({ incidents: [FULL, BARE], total: 7 })
  api.getAllSettings.mockReset().mockResolvedValue({ home_city: "Oberwil" })
  api.getVehicles.mockReset().mockResolvedValue(VEHICLES)
  api.getEventRestliste.mockReset().mockResolvedValue(RESTLISTE)
  api.getEventSpecialFunctions.mockReset().mockResolvedValue(SPECIAL_FUNCTIONS)
  api.getAssignmentsByEvent.mockReset().mockResolvedValue(ASSIGNMENTS)
  api.getEventRekoSummaries.mockReset().mockResolvedValue(REKO_SUMMARIES)
  refreshPersonnel.mockReset().mockResolvedValue(PERSONNEL)
  refreshMaterials.mockReset().mockResolvedValue(MATERIALS)
})

async function loaded() {
  const rendered = renderHook(() => useOperations(), { wrapper })
  await waitFor(() => expect(rendered.result.current.operations).toHaveLength(2))
  return rendered.result.current
}

describe("OperationsProvider — the board snapshot (golden)", () => {
  it("maps a fully populated incident and folds its assignments onto the card", async () => {
    const board = await loaded()
    expect(board.operations[0]).toEqual({
      id: "inc-full",
      location: "Hauptstrasse 12, 4104 Oberwil",
      locationDisplay: "Hauptstrasse 12",
      vehicle: null,
      vehicles: ["TLF", "MTW"],
      incidentType: "elementarereignis",
      dispatchTime: new Date("2026-09-23T08:00:00Z"),
      crew: ["Anna Crew", "Beat Leader"],
      priority: "high",
      status: "active",
      coordinates: [47.515, 7.556],
      materials: ["m-pump"],
      notes: "Keller 20 cm",
      contact: "Frau Muster",
      contactPhone: "+41 61 000 00 00",
      internalNotes: "Hund im Haus",
      nachbarhilfe: true,
      nachbarhilfeNote: "Nachbar hilft pumpen",
      amWarten: true,
      amWartenNote: "wartet auf Pumpe",
      zuFuss: true,
      groupId: "grp-1",
      groupPosition: 2,
      source: "feld",
      fromRealAlarm: true,
      statusChangedAt: new Date("2026-09-23T08:20:00Z"),
      hasCompletedReko: true,
      rekoArrivedAt: new Date("2026-09-23T08:10:00Z"),
      rekoArrivedByKp: true,
      fieldCompleteReportedAt: new Date("2026-09-23T08:40:00Z"),
      fieldCompleteReportedBy: "p-crew",
      fieldArrivedAt: new Date("2026-09-23T08:25:00Z"),
      fieldArrivedBy: null,
      fieldArrivedByAutomation: true,
      pickupNeeded: true,
      pickupNote: "4 Personen",
      pickupRequestedAt: new Date("2026-09-23T08:45:00Z"),
      pickupRequestedBy: "p-crew",
      hasSchadenplatzRapport: true,
      hasSchadenplatzRapportDraft: false,
      hasBeenDispatched: true,
      rekoSummary: {
        isRelevant: true,
        hasDangers: true,
        dangerTypes: ["Brandgefahr", "Einsturz", "Elektrisch"],
        personnelCount: 4,
        estimatedDuration: 2,
        summaryText: "Pumpen nötig",
        photos: ["a.jpg"],
      },
      assignedReko: { id: "p-reko", name: "Claudia Reko" },
      // The live `is_leader` row beats the leader of record.
      leaderName: "Beat Leader",
      crewAssignments: new Map([["Anna Crew", "a-crew"], ["Beat Leader", "a-lead"]]),
      materialAssignments: new Map([["m-pump", "a-pump"]]),
      vehicleAssignments: new Map([["MTW", "a-mtw"], ["TLF", "a-tlf"]]),
      vehicleCallsigns: new Map([["TLF", "Omega 1"]]),
      vehicleDriverStay: new Map([["MTW", false], ["TLF", true]]),
    })
  })

  it("fills a bare incident with the board's defaults, never with undefined", async () => {
    const board = await loaded()
    expect(board.operations[1]).toEqual({
      id: "inc-bare",
      location: "Baum auf Strasse",
      locationDisplay: undefined,
      vehicle: null,
      vehicles: [],
      incidentType: "elementarereignis",
      dispatchTime: new Date("2026-09-23T09:00:00Z"),
      crew: [],
      priority: "low",
      status: "incoming",
      // Half a coordinate is no coordinate.
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
      source: "operator",
      fromRealAlarm: false,
      statusChangedAt: null,
      hasCompletedReko: false,
      rekoArrivedAt: null,
      rekoArrivedByKp: false,
      fieldCompleteReportedAt: null,
      fieldCompleteReportedBy: null,
      fieldArrivedAt: null,
      fieldArrivedBy: null,
      fieldArrivedByAutomation: false,
      pickupNeeded: false,
      pickupNote: "",
      pickupRequestedAt: null,
      pickupRequestedBy: null,
      hasSchadenplatzRapport: false,
      hasSchadenplatzRapportDraft: false,
      hasBeenDispatched: false,
      rekoSummary: null,
      assignedReko: null,
      leaderName: null,
      crewAssignments: new Map(),
      materialAssignments: new Map(),
      vehicleAssignments: new Map(),
      vehicleCallsigns: new Map(),
      vehicleDriverStay: new Map(),
    })
  })

  it("scopes the roster to this Ereignis: who is bound, and by what", async () => {
    const board = await loaded()
    const byId = new Map(board.personnel.map((p) => [p.id, p]))
    const flags = (id: string) => {
      const p = byId.get(id)!
      return {
        status: p.status,
        isReko: p.isReko,
        isDriver: p.isDriver,
        driverVehicleId: p.driverVehicleId,
        driverVehicleName: p.driverVehicleName,
        isMagazin: p.isMagazin,
        isTelefondienst: p.isTelefondienst,
        isKommandoposten: p.isKommandoposten,
      }
    }
    const none = { isReko: false, isDriver: false, driverVehicleId: undefined, driverVehicleName: undefined, isMagazin: false, isTelefondienst: false, isKommandoposten: false }
    expect(flags("p-crew")).toEqual({ ...none, status: "assigned" })
    expect(flags("p-lead")).toEqual({ ...none, status: "assigned" })
    // A Reko officer is flagged, but not «assigned» by the function alone —
    // and their Reko row on a card does not make them crew either.
    expect(flags("p-reko")).toEqual({ ...none, status: "available", isReko: true })
    expect(flags("p-driver")).toEqual({ ...none, status: "assigned", isDriver: true, driverVehicleId: "v-tlf", driverVehicleName: "TLF" })
    expect(flags("p-mag")).toEqual({ ...none, status: "assigned", isMagazin: true })
    expect(flags("p-tel")).toEqual({ ...none, status: "assigned", isTelefondienst: true })
    expect(flags("p-kp")).toEqual({ ...none, status: "assigned", isKommandoposten: true })
    expect(flags("p-other")).toEqual({ ...none, status: "assigned" })
    expect(flags("p-free")).toEqual({ ...none, status: "available" })
    // Order and the rest of each row are the roster's own.
    expect(board.personnel.map((p) => p.id)).toEqual(PERSONNEL.map((p) => p.id))
    expect(byId.get("p-crew")).toMatchObject({ name: "Anna Crew", role: "AdF", roleSortOrder: 0 })
  })

  it("derives material deployment from this Ereignis and leaves readiness alone", async () => {
    const board = await loaded()
    expect(board.materials.map((m) => [m.id, m.status, m.outOfService])).toEqual([
      ["m-pump", "assigned", false],
      // «assigned» from the API but on no card here: free on this board.
      ["m-saw", "available", false],
      ["m-broken", "available", true],
    ])
    expect(board.materials[2].outOfServiceSince).toBe("2026-09-01T00:00:00Z")
  })

  it("indexes what is still on site, the fleet's readiness and the raw lists", async () => {
    const board = await loaded()
    expect(board.materialOnSite).toEqual(
      new Map([
        ["m-pump", { incidentId: "inc-full", address: "Hauptstrasse 12", since: "2026-09-23T09:00:00Z" }],
        ["m-saw", { incidentId: "inc-full", address: "Wasser im Keller", since: null }],
      ]),
    )
    expect(board.outOfServiceVehicleIds).toEqual(new Set(["v-dlk"]))
    expect(board.incidentTotal).toBe(7)
    expect(board.homeCity).toBe("Oberwil")
    expect(board.settings).toEqual({ home_city: "Oberwil" })
    expect(board.vehicles).toBe(VEHICLES)
    expect(board.specialFunctions).toBe(SPECIAL_FUNCTIONS)
  })
})

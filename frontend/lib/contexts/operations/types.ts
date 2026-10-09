/**
 * The board's types: `Operation` (one card), the context contract and the sync
 * status. Re-exported from `operations-context.tsx`, which is where callers import them.
 */

import type {
  ApiEventSpecialFunctionResponse,
  ApiFieldRequest,
  ApiIncidentCreate,
  ApiIncidentUpdate,
  ApiVehicle,
  IncidentStatus,
} from "@/lib/api-client"
import type { IncidentCoordinates } from "@/lib/coordinate-parser"
import type { Person } from "../personnel-context"
import type { Material } from "../materials-context"

export type PersonRole = string

// Types
// The board's status vocabulary IS the API's — one set of seven identifiers,
// shared by database, API and board, so nothing translates between them. The
// German an operator reads comes from `de.json`, keyed on these same values.
export type OperationStatus = IncidentStatus
export type VehicleType = string | null

/** Payload of an `assignment_update` with `action: 'driver_stay'`. */
export interface DriverStayPayload {
  id?: string
  incident_id?: string
  driver_stay?: boolean
}

/** Callers pass coordinates as numbers; the API wants decimal strings. */
export interface CoordinateInput {
  location_lat?: number | string | null
  location_lng?: number | string | null
}
export type IncidentCreateInput = Omit<ApiIncidentCreate, "location_lat" | "location_lng"> & CoordinateInput
export type IncidentUpdateInput = Omit<ApiIncidentUpdate, "location_lat" | "location_lng"> & CoordinateInput

export interface RekoSummary {
  isRelevant: boolean
  hasDangers: boolean
  dangerTypes: string[]
  personnelCount: number | null
  estimatedDuration: number | null
  /** What the Reko wrote — the sentence the form calls «Lagebeurteilung». */
  summaryText: string | null
  /** Photo filenames from the Reko form; resolve via `rekoPhotoUrl`. */
  photos: string[]
}

export interface Operation {
  id: string
  /** The incident's number within its Ereignis — «14» on the card and in ⌘K
   *  («14 tlf meier»). Server-assigned and never reused; absent on an optimistic
   *  card until the POST answers, and from a backend that predates it. */
  number?: number | null
  location: string
  /** Server-computed short location label (home city stripped). Absent on
   *  locally-created optimistic operations until the next server sync. */
  locationDisplay?: string
  vehicle: VehicleType
  vehicles: string[]
  incidentType: string
  dispatchTime: Date
  crew: string[]
  priority: "high" | "medium" | "low"
  status: OperationStatus
  coordinates: IncidentCoordinates
  materials: string[]
  notes: string
  contact: string
  contactPhone: string
  internalNotes: string
  nachbarhilfe: boolean
  nachbarhilfeNote: string
  amWarten: boolean
  amWartenNote: string
  zuFuss: boolean
  /** Auftrag (incident group) this stop belongs to, or null when ungrouped. */
  groupId: string | null
  /** Order of this stop within its Auftrag (lower = earlier). 0 when ungrouped. */
  groupPosition: number
  source?: string // Origin: "operator" (dashboard), "intake" (phone/walk-in), "feld" (a Trupp), or a delivering system's slug. Absent for locally-created ops.
  /** Server-derived: this incident came from a GENUINE dispatch alarm rather
   *  than a simulated drill one. Meaningful only inside a training Ereignis,
   *  where the card says so — the only per-incident marker the training mode
   *  has, because such an incident deviates from the Ereignis around it. */
  fromRealAlarm?: boolean
  /** An automatic door created this card next to an open one (that card's id):
   *  the card shows «Mögliches Duplikat von …» with a one-click merge. */
  possibleDuplicateOf?: string | null
  statusChangedAt: Date | null
  hasCompletedReko: boolean
  rekoArrivedAt: Date | null
  /** True when an operator logged the arrival off a radio message rather than
   *  the crew tapping it on `/reko`. Read straight through to the Feldmeldungen
   *  row, which is the one place "vor Ort" is shown at all (plan 26 §5.2). */
  rekoArrivedByKp?: boolean
  /** Set when the field crew reported the incident finished. Drives the
   *  "Feld meldet: beendet" card badge; the operator still closes it manually. */
  fieldCompleteReportedAt?: Date | null
  /** Who reported it — null means the KP took it over the radio. Provenance is
   *  never faked, so the absence of an id IS the "im KP erfasst" case. */
  fieldCompleteReportedBy?: string | null
  /** "Angekommen" from /feld. */
  fieldArrivedAt?: Date | null
  /** Who reported it — null means the KP took it over the radio. */
  fieldArrivedBy?: string | null
  /** …or the GPS automation stamped it (§18.24): an assigned vehicle was
   *  confirmed at the address and the automation advanced the incident. Its own
   *  provenance — the thread must not word a machine's inference as a person's
   *  report, in either direction. */
  fieldArrivedByAutomation?: boolean
  /** "Abholung nötig": finished here, but the crew cannot get back on its own.
   *  Survives the card moving to `complete` — completing releases the personnel
   *  while they are still standing at the address, which is the whole point. */
  pickupNeeded?: boolean
  pickupNote?: string
  pickupRequestedAt?: Date | null
  pickupRequestedBy?: string | null
  /** The field's requests still to be worked (R13): open + «in Arbeit», oldest
   *  first. The card shows them, the sidebar lists them across the board. */
  fieldRequests?: ApiFieldRequest[]
  /** A Schadenplatz-Rapport has been FILED for this incident (not a draft).
   *  Drives the card chip, and the muted "kein Rapport" marker once a card
   *  reaches `complete` without one — a marker, never a block (decision 10). */
  hasSchadenplatzRapport?: boolean
  /** A rapport row exists but is still a DRAFT — somebody started and walked
   *  away. Mutually exclusive with the flag above; the detail's Rapport tab
   *  tells the two apart because at 02:00 they read very differently. */
  hasSchadenplatzRapportDraft?: boolean
  /** The incident has been disponiert at least once — ever, not right now
   *  (§18.27). It is what decides whether the Schadenplatz-Rapport exists for
   *  this card; read it through `rapportApplies` in `lib/rapport-visibility`,
   *  never on its own, so an already-filed rapport can never be hidden. */
  hasBeenDispatched?: boolean
  rekoSummary: RekoSummary | null
  assignedReko: { id: string; name: string } | null
  /** Name of the crew member marked Einsatzleiter for THIS incident, or null.
   *  A stop that belongs to an Auftrag takes its leader from the route instead
   *  (the route owns the resources).
   *  Seeded from the backend's `leader_name` (the effective leader — active
   *  `is_leader` assignment, or the leader of record once the crew is
   *  released), then overwritten by the live `is_leader` assignment when one
   *  exists. That is what keeps it non-null on CLOSED incidents, where the
   *  assignments are gone but somebody still has to be phoned about the
   *  rapport. */
  leaderName: string | null
  crewAssignments: Map<string, string>
  materialAssignments: Map<string, string>
  vehicleAssignments: Map<string, string>
  vehicleCallsigns: Map<string, string> // vehicle name -> radio_call_sign
  vehicleDriverStay: Map<string, boolean>
}

/**
 * Context interface for managing operations, personnel, and materials.
 * Personnel and materials are delegated to their own contexts but exposed here for backward compatibility.
 */
/** A vehicle the driver prompt should ask about. `incidentId` / `groupId` name
 *  where it was just assigned, so dismissing can ask whether it comes back off. */
export interface VehicleNeedingDriver {
  vehicleId: string
  vehicleName: string
  incidentId?: string
  groupId?: string
}

export interface OperationsContextType {
  // Delegated from PersonnelContext
  personnel: Person[]
  setPersonnel: React.Dispatch<React.SetStateAction<Person[]>>
  // Delegated from MaterialsContext
  materials: Material[]
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>
  // Operations state
  operations: Operation[]
  setOperations: React.Dispatch<React.SetStateAction<Operation[]>>
  homeCity: string
  isLoading: boolean
  /** True once the first data load has resolved. Stays true afterwards.
   * Gate empty states on this so they only show when data is genuinely empty,
   * never during the initial blank-before-fetch window. */
  isLoaded: boolean
  /**
   * The board has never arrived: a load failed and no load has ever got
   * through (`loadError` set, `lastSyncAt` null). `isLoaded` is true then too,
   * so without this an unreachable server painted empty columns, «0» counts and
   * «Niemand angemeldet» — an empty Ereignis. Empty states must check this
   * before they say «nothing».
   *
   * Derived here rather than read off `useBoardSyncStatus()` on purpose: it
   * flips at most twice a session, while the sync status ticks every poll, and
   * the board page must not re-render on every tick to learn a boolean.
   */
  boardNeverLoaded: boolean
  /**
   * Total incidents for the selected event, before the server's limit. Null when unknown
   * (older backend, or header stripped by a proxy) — never treat null as zero. Compare
   * against `operations.length` to tell whether the board is showing everything.
   */
  incidentTotal: number | null
  formatLocation: (fullAddress: string) => string
  refreshOperations: () => Promise<void>
  /** Resolves true when the removal was persisted (or ran local-only), false
   * when it failed and was rolled back — callers that chain a follow-up
   * action (e.g. "remove from incident, then make driver") must check it. */
  removeCrew: (operationId: string, crewName: string) => Promise<boolean>
  removeMaterial: (operationId: string, materialId: string) => Promise<boolean>
  /** Same result contract as removeCrew. */
  removeVehicle: (operationId: string, vehicleName: string) => Promise<boolean>
  removeReko: (operationId: string) => void
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  /** Persist the manual top-to-bottom order of a status column after a drag-reorder. */
  reorderColumn: (orderedIds: string[]) => void
  /** Board drag lifecycle. While a card is being dragged, remote updates are
   * queued instead of applied — a mid-drag reload remounts the columns and
   * aborts the native drag. Call with false when the drag ends (any outcome). */
  setBoardDragging: (dragging: boolean) => void
  /** Change an incident's status and move it to the TOP of the target column —
   *  the one-click equivalent of dragging it across (mirrors the reko auto-move). */
  changeStatusToTop: (operationId: string, newStatus: OperationStatus, extraUpdates?: Partial<Operation>) => void
  createOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  /** «Zusammenführen» from «Neuer Einsatz»: the typed report becomes a Nachtrag
   *  on `targetId` (no new card) and an undo toast is offered. Resolves false
   *  when the server refused or the call failed (a toast already said so). */
  mergeOperationInto: (operation: Omit<Operation, "id" | "dispatchTime">, targetId: string) => Promise<boolean>
  /** «Zusammenführen» on a flagged card: fold the card into `targetId`. */
  mergeExistingOperation: (operationId: string, targetId: string) => Promise<boolean>
  /** «Trennen» / the toast's «Rückgängig»: the merged report is its own card again. */
  undoMerge: (mergedIncidentId: string) => Promise<boolean>
  getNextOperationId: () => string
  /** The three resource assigns resolve true once the assignment landed (or ran
   *  local-only) and false when nothing was assigned — refused (already there,
   *  out of service), handed to the conflict prompt, or failed and rolled back
   *  (they toast that themselves). Fire-and-forget callers can ignore it. */
  assignPersonToOperation: (personId: string, personName: string, operationId: string, force?: boolean) => Promise<boolean>
  assignRekoPersonToOperation: (personId: string, personName: string, operationId: string) => void
  assignMaterialToOperation: (materialId: string, operationId: string, force?: boolean) => Promise<boolean>
  assignVehicleToOperation: (vehicleId: string, vehicleName: string, operationId: string) => Promise<boolean>
  /** The vehicle the driver prompt is asking about: set when a vehicle is assigned
   * to an incident and nobody is driving it. Exactly one at a time — the setup
   * checklist used to queue a run through every driverless vehicle here, and that
   * went to the Fahrzeuge sheet instead, where the whole fleet is visible at once.
   * The user may dismiss the prompt to leave the vehicle without a driver. */
  vehicleNeedingDriver: VehicleNeedingDriver | null
  /** Close the prompt — both after assigning and on dismissal. */
  clearVehicleNeedingDriver: () => void
  /** Open the same driver prompt from elsewhere: an Auftrag that just got a
   *  driverless vehicle (`groupId`), or a «Fahrer wählen» action (no target —
   *  the operator asked, so dismissing asks nothing back). */
  requestVehicleDriver: (request: VehicleNeedingDriver) => void
  /** Set when a resource is being assigned to an incident while it is still
   * assigned to one or more other incidents. The UI prompts the operator to
   * either move it (remove from the others) or keep the double booking;
   * dismissing leaves everything where it is. Resolved via
   * resolveResourceConflict / cancelResourceConflict.
   *
   * It covers all three resource kinds, not just vehicles. It used to be
   * vehicle-only, and the other two silently no-oped instead: assigning a person
   * or a unit of material that was already on another incident simply returned,
   * which meant even the assignment dialog's own «Doppelbelegung? Trotzdem
   * zuweisen» did nothing at all. A person and a Tauchpumpe are as single and as
   * physical as a TLF — the operator has to be asked, not ignored. */
  resourceConflict:
    | {
        resourceType: "personnel" | "vehicle" | "material"
        resourceId: string
        /** Display name; also the key crew/vehicle lists are held under. */
        resourceName: string
        targetOperationId: string
        /** Where it is going, by name — the dialog's «Neu:» line. The question
         *  «wovon wird abgezogen» has two halves and the prompt used to name
         *  only one of them, in running text. */
        targetOperationLabel?: string
        conflicts: { operationId: string; operationLabel: string }[]
        customResolve?: (action: "move" | "keep") => Promise<void> | void
      }
    | null
  /** Material a crew left standing at a Schadenplatz, keyed on material id.
   *
   * "zugewiesen" and "steht noch im Keller" are not the same fact, and only the
   * second one sends somebody driving in the morning. The rapport has known this
   * since §18.35 (`left_on_site`) but only the Restliste and the printed
   * Abholliste ever read it, so the board itself — the surface an operator
   * actually watches — showed a pump in a stranger's cellar exactly like a pump
   * on a truck. Read from the same `/restliste` endpoint the Abholliste prints,
   * so there is one computation of "what is still out there", not two. */
  materialOnSite: Map<string, { incidentId: string; address: string | null; since: string | null }>
  /** Vehicle ids flagged «Nicht einsatzbereit» in the fleet list.
   *
   * Vehicles have no sidebar of their own, so their readiness has to travel with
   * the board state: the shortcut keys, the assignment dialog and the drop
   * targets all read this set. Until now nothing on the board consulted a
   * vehicle's state at all — a unit recorded as defective was assignable. */
  outOfServiceVehicleIds: Set<string>
  /** The raw lists behind the last good board load, as fetched — handed out so
   *  derived views (the Bereitschaft checklist) read the board's snapshot
   *  instead of polling the same endpoints again on their own timer. */
  specialFunctions: ApiEventSpecialFunctionResponse[]
  vehicles: ApiVehicle[]
  /** All settings as of the last load that got them (kept through a failed fetch). */
  settings: Record<string, string>
  resolveResourceConflict: (action: "move" | "keep") => void
  cancelResourceConflict: () => void
  requestResourceConflict: (conflict: NonNullable<OperationsContextType["resourceConflict"]>) => void
  /**
   * Assignment work whose questions may still come: a vehicle assign until its
   * driver check answered (two round trips after the vehicle landed), a
   * resolved Doppelbelegung until its removals and the re-assign are done.
   * `begin` returns the matching `end` (idempotent). ⌘K's dispatch runner reads
   * `isAssignmentSettling` so the next resource is not handed over while a
   * question is still on its way.
   */
  beginAssignmentSettling: () => () => void
  isAssignmentSettling: () => boolean
  deleteOperation: (operationId: string) => Promise<void>
}

/** The actions the provider hands out through stable wrappers — see the value memo. */
export type BoardActions = Pick<
  OperationsContextType,
  | "removeCrew"
  | "removeMaterial"
  | "removeVehicle"
  | "removeReko"
  | "updateOperation"
  | "reorderColumn"
  | "changeStatusToTop"
  | "createOperation"
  | "mergeOperationInto"
  | "mergeExistingOperation"
  | "undoMerge"
  | "getNextOperationId"
  | "assignPersonToOperation"
  | "assignRekoPersonToOperation"
  | "assignMaterialToOperation"
  | "assignVehicleToOperation"
  | "resolveResourceConflict"
  | "deleteOperation"
>

/**
 * How fresh the board is — split off the main context on purpose.
 *
 * `lastSyncAt` moves on every confirmed-fresh poll tick (every ~5 s while the
 * socket is down) without a single card changing. In the main value that
 * re-rendered all ~40 `useOperations()` consumers each time, for the benefit
 * of the one component that reads it (the stale-data banner).
 */
export interface BoardSyncStatus {
  /** Wall-clock time of the last successful sync — a completed board load or a
   *  poll that confirmed nothing changed. null until the first load completes.
   *  A failed load leaves it where it was: that is what ages the board. */
  lastSyncAt: Date | null
  /** Why the most recent board load failed; null once a sync gets through.
   *  While set, the board on screen is the last good state (or, after a failed
   *  FIRST load, nothing at all — which `isLoaded` alone can't tell apart
   *  from an empty Ereignis). */
  loadError: Error | null
  /** When the WebSocket last came up (null while it is not connected). A
   *  socket only carries freshness once a board load has got through AFTER
   *  this moment — events broadcast while it was down are gone, and the
   *  resync it triggers can fail. The stale banner compares the two. */
  liveSince: Date | null
}

import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { useEvent } from "../event-context"
import type { RecentRemovals } from "@/lib/recent-removals"
import type { KeyedSerialQueue, UpdateBatcher } from "@/lib/update-batcher"
import type { Person } from "../personnel-context"
import type { Material } from "../materials-context"
import type { Operation, OperationsContextType, StatusWriteGuard, VehicleNeedingDriver } from "./types"

/** How long the board keeps holding remote reloads back after a mutation's request
 *  settled (the default of `releaseAssignmentCooldown`). */
export const MUTATION_COOLDOWN_GRACE_MS = 500

/**
 * What the board's mutations read and write: this render's state plus the
 * provider's setters, refs and cooldown hooks. The action factories are called
 * on every render of `OperationsProvider`, so each action closes over that
 * render's values exactly as it did when it was declared inline.
 */
export interface BoardMutationContext {
  operations: Operation[]
  personnel: Person[]
  materials: Material[]
  isLoaded: boolean
  selectedEvent: ReturnType<typeof useEvent>["selectedEvent"]
  resourceConflict: OperationsContextType["resourceConflict"]
  outOfServiceVehicleIds: Set<string>
  setOperations: Dispatch<SetStateAction<Operation[]>>
  setPersonnel: Dispatch<SetStateAction<Person[]>>
  setMaterials: Dispatch<SetStateAction<Material[]>>
  setResourceConflict: Dispatch<SetStateAction<OperationsContextType["resourceConflict"]>>
  setVehicleNeedingDriver: Dispatch<SetStateAction<VehicleNeedingDriver | null>>
  operationsRef: MutableRefObject<Operation[]>
  /** The Ereignis selected now – for an answer that lands after a switch. */
  selectedEventIdRef: MutableRefObject<string | null>
  recentRemovalsRef: MutableRefObject<RecentRemovals>
  criticalUpdateInProgress: MutableRefObject<boolean>
  mutationEpochRef: MutableRefObject<number>
  patchQueueRef: MutableRefObject<KeyedSerialQueue>
  /** One Reko-order POST in flight per Reko person (`reorderRekos`). */
  rekoOrderQueueRef: MutableRefObject<KeyedSerialQueue>
  updateBatcherRef: MutableRefObject<UpdateBatcher<Operation>>
  /** Per incident: the status the board showed when its pending status write was made
   *  (sent as `from_status`, see `updateOperation`). Set at the first status edit of a
   *  batch, taken when the batch is sent. */
  statusGuardRef: MutableRefObject<Map<string, StatusWriteGuard>>
  reorderInFlightRef: MutableRefObject<boolean>
  queuedReorderRef: MutableRefObject<string[] | null>
  armAssignmentCooldown: () => void
  releaseAssignmentCooldown: (graceMs?: number) => void
  beginAssignmentSettling: () => () => void
  refreshOperations: () => Promise<boolean>
}

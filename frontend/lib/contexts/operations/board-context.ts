import type { Dispatch, MutableRefObject, SetStateAction } from "react"
import type { useEvent } from "../event-context"
import type { RecentRemovals } from "@/lib/recent-removals"
import type { KeyedSerialQueue, UpdateBatcher } from "@/lib/update-batcher"
import type { Person } from "../personnel-context"
import type { Material } from "../materials-context"
import type { Operation, OperationsContextType, VehicleNeedingDriver } from "./types"

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
  recentRemovalsRef: MutableRefObject<RecentRemovals>
  criticalUpdateInProgress: MutableRefObject<boolean>
  mutationEpochRef: MutableRefObject<number>
  patchQueueRef: MutableRefObject<KeyedSerialQueue>
  updateBatcherRef: MutableRefObject<UpdateBatcher<Operation>>
  reorderInFlightRef: MutableRefObject<boolean>
  queuedReorderRef: MutableRefObject<string[] | null>
  armAssignmentCooldown: () => void
  releaseAssignmentCooldown: (graceMs?: number) => void
  beginAssignmentSettling: () => () => void
  refreshOperations: () => Promise<void>
}

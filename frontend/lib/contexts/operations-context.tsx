"use client"

import { useContext, useState, useEffect, useMemo, ReactNode, useRef, useCallback } from "react"
import { formatLocationForDisplay } from "@/lib/utils"
import { useAuth } from "./auth-context"
import { useEvent } from "./event-context"
import { usePersonnel } from "./personnel-context"
import { useMaterials } from "./materials-context"
import type { RecentRemovals } from "@/lib/recent-removals"
import { KeyedSerialQueue, UpdateBatcher } from "@/lib/update-batcher"
import { fieldSaveScope, setFieldSaveScope, unsavedFieldDrafts } from "@/lib/field-save"
import { OperationsContext, BoardSyncStatusContext } from "./operations/contexts"
import { useAlertAudio } from "./operations/use-alert-audio"
import { useBoardSync } from "./operations/use-board-sync"
import type { BoardMutationContext } from "./operations/board-context"
import { createResourceActions } from "./operations/resource-actions"
import { createIncidentActions } from "./operations/incident-actions"
import type {
  BoardActions,
  BoardSyncStatus,
  Operation,
  OperationsContextType,
  VehicleNeedingDriver,
} from "./operations/types"

// The board's state lives here; its parts live in ./operations/: types, the
// loader + live sync (use-board-sync), the mutations (resource-actions,
// incident-actions), the alert sound and the useIncidents adapter.

// Re-export types for backward compatibility
export type { Person, PersonStatus } from "./personnel-context"
export type { Material } from "./materials-context"
export type {
  PersonRole,
  OperationStatus,
  VehicleType,
  RekoSummary,
  Operation,
  VehicleNeedingDriver,
  BoardSyncStatus,
} from "./operations/types"
// The danger chips of a Reko — derived in ./operations/mapping, still importable from here.
export { rekoDangerTypes } from "./operations/mapping"
export { useIncidents } from "./operations/use-incidents"

export function OperationsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading: authLoading, user } = useAuth()
  const { selectedEvent, isEventLoaded } = useEvent()

  // Text drafts belong to one operator in one Ereignis (lib/field-save). A
  // different user — or a signed-out session — drops the previous one's.
  const authUserId = isAuthenticated ? (user?.id ?? null) : null
  useEffect(() => {
    setFieldSaveScope(fieldSaveScope(authUserId, selectedEvent?.id))
  }, [authUserId, selectedEvent?.id])

  // A text that did not reach the server is only in this window: closing or
  // reloading it loses the text, so the browser asks first.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsavedFieldDrafts().length === 0) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Get personnel and materials from their dedicated contexts
  const { personnel, setPersonnel, refreshPersonnel } = usePersonnel()
  const { materials, setMaterials, refreshMaterials } = useMaterials()

  // Operations state (only operations-specific state here)
  const [operations, setOperations] = useState<Operation[]>([])
  // Always-current mirror of `operations` for reads inside async callbacks that
  // would otherwise close over a stale snapshot (e.g. the post-assign driver prompt).
  const operationsRef = useRef<Operation[]>([])
  operationsRef.current = operations
  const [isLoaded, setIsLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  // Mirror for reads inside the long-lived sync effect: having isLoading in
  // its dependency array tore down and rebuilt the whole WebSocket+polling
  // setup on every loading flip (multiple reconnects during startup).
  const isLoadingRef = useRef(false)
  isLoadingRef.current = isLoading
  // The one vehicle that was just put on an incident with nobody driving it, or
  // null. It was a queue while the setup checklist walked every driverless vehicle
  // through the same prompt; that run is gone, and a queue that can only ever hold
  // one entry is a queue pretending.
  const [vehicleNeedingDriver, setVehicleNeedingDriver] = useState<VehicleNeedingDriver | null>(null)
  const clearVehicleNeedingDriver = useCallback(() => setVehicleNeedingDriver(null), [])
  const requestVehicleDriver = useCallback((request: VehicleNeedingDriver) => setVehicleNeedingDriver(request), [])
  const [resourceConflict, setResourceConflict] = useState<OperationsContextType["resourceConflict"]>(null)

  // Refs for debouncing and cooldowns. One debounce timer + pending-merge
  // buffer PER incident (a single shared timer made rapid edits to two
  // different incidents silently drop the first one's PATCH).
  const updateBatcherRef = useRef<UpdateBatcher<Operation>>(new UpdateBatcher())
  // …and one PATCH in flight per incident, in order — see KeyedSerialQueue.
  const patchQueueRef = useRef<KeyedSerialQueue>(new KeyedSerialQueue())
  const criticalUpdateInProgress = useRef<boolean>(false)
  // Refcounted cooldown: every optimistic mutation takes a hold when it
  // starts and releases it (plus a grace period) when its request settles.
  // A single boolean + shared timer let a FAST mutation clear the cooldown
  // while a SLOWER one was still in flight — a poll could then load
  // pre-mutation state and visibly snap the slow mutation back. This also
  // replaces the old fixed 2s status cooldown, which could expire while a
  // slow status PATCH was still in flight.
  const assignmentHoldsRef = useRef<number>(0)
  // True while an operation card is physically being dragged. Remote updates
  // queue for the duration: a mid-drag reload remounts the columns, which
  // aborts the native drag and silently drops the card back.
  const boardDraggingRef = useRef<boolean>(false)
  // Serialize reorder POSTs: two rapid drags could land out of order
  // server-side, silently persisting the FIRST drag's order. Only the latest
  // queued order survives; intermediates are skipped.
  const reorderInFlightRef = useRef<boolean>(false)
  const queuedReorderRef = useRef<string[] | null>(null)
  const replayPendingUpdatesRef = useRef<(() => void) | null>(null)
  // B6: client-only memory of recent crew removals so we can warn on
  // rapid re-assignment ("you took Müller off A 30s ago, now putting
  // them on B"). Lives in a ref because it's purely informational
  // and shouldn't trigger re-renders.
  const recentRemovalsRef = useRef<RecentRemovals>(new Map())

  // Every optimistic local mutation bumps this epoch. Reloads capture it when
  // they START fetching and discard their result if it moved while they were
  // in flight — otherwise a reload that began just before a drag/assign lands
  // would overwrite the optimistic state with a pre-mutation snapshot
  // (visible as the card "snapping back" for a second or two).
  const mutationEpochRef = useRef<number>(0)

  // Shared preamble of every optimistic mutation: invalidate in-flight
  // reloads and take one cooldown hold. Must be paired with exactly one
  // releaseAssignmentCooldown call once the mutation's request settles.
  const armAssignmentCooldown = () => {
    mutationEpochRef.current++
    assignmentHoldsRef.current++
  }

  // Release the hold taken by armAssignmentCooldown after a short grace
  // period; when the last hold drops, replay any queued remote update.
  const releaseAssignmentCooldown = (graceMs = 500) => {
    setTimeout(() => {
      assignmentHoldsRef.current = Math.max(0, assignmentHoldsRef.current - 1)
      if (assignmentHoldsRef.current === 0) replayPendingUpdatesRef.current?.()
    }, graceMs)
  }

  // Card drag lifecycle, wired from the board via context. Ending a drag
  // replays queued remote updates — an aborted drag would otherwise leave
  // them waiting for an unrelated mutation to flush the queue.
  const setBoardDragging = useCallback((dragging: boolean) => {
    if (boardDraggingRef.current === dragging) return
    boardDraggingRef.current = dragging
    if (!dragging) replayPendingUpdatesRef.current?.()
  }, [])

  const { alertAudioRef, alertAudioUnlockedRef } = useAlertAudio()

  // Flush debounced board edits when the page is hidden or closed — the
  // debounce window must not silently swallow the last edit (classic case:
  // drag the last card to ABGESCHLOSSEN, close the laptop). updateIncident
  // sends keepalive requests, so the flushed PATCH outlives the document.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const batcher = updateBatcherRef.current
    const flushPending = () => batcher.flushAll()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPending()
    }
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flushPending)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      // Provider unmount: fire whatever is still pending.
      flushPending()
    }
  }, [])

  // Load, live updates, polling fallback and sync freshness — ./operations/use-board-sync.
  const {
    homeCity,
    lastSyncAt,
    loadError,
    liveSince,
    incidentTotal,
    materialOnSite,
    outOfServiceVehicleIds,
    specialFunctions,
    vehicles,
    settings,
    refreshOperations,
  } = useBoardSync({
    authLoading,
    isAuthenticated,
    selectedEvent,
    isEventLoaded,
    refreshPersonnel,
    refreshMaterials,
    setPersonnel,
    setMaterials,
    setOperations,
    setIsLoaded,
    setIsLoading,
    isLoadingRef,
    replayPendingUpdatesRef,
    criticalUpdateInProgress,
    boardDraggingRef,
    assignmentHoldsRef,
    mutationEpochRef,
    alertAudioRef,
    alertAudioUnlockedRef,
  })

  const cancelResourceConflict = useCallback(() => setResourceConflict(null), [])
  const settlingRef = useRef(0)
  const beginAssignmentSettling = useCallback(() => {
    settlingRef.current++
    let ended = false
    return () => {
      if (ended) return
      ended = true
      settlingRef.current--
    }
  }, [])
  const isAssignmentSettling = useCallback(() => settlingRef.current > 0, [])
  const requestResourceConflict = useCallback((conflict: NonNullable<OperationsContextType["resourceConflict"]>) => {
    setResourceConflict(conflict)
  }, [])

  // The board's mutations, rebuilt every render over this render's state — exactly
  // what they were while declared inline here (./operations/board-context).
  const board: BoardMutationContext = {
    operations,
    personnel,
    materials,
    isLoaded,
    selectedEvent,
    resourceConflict,
    outOfServiceVehicleIds,
    setOperations,
    setPersonnel,
    setMaterials,
    setResourceConflict,
    setVehicleNeedingDriver,
    operationsRef,
    recentRemovalsRef,
    criticalUpdateInProgress,
    mutationEpochRef,
    patchQueueRef,
    updateBatcherRef,
    reorderInFlightRef,
    queuedReorderRef,
    armAssignmentCooldown,
    releaseAssignmentCooldown,
    beginAssignmentSettling,
    refreshOperations,
  }
  const {
    removeCrew,
    removeReko,
    removeMaterial,
    removeVehicle,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    resolveResourceConflict,
  } = createResourceActions(board)
  const {
    updateOperation,
    reorderColumn,
    changeStatusToTop,
    getNextOperationId,
    createOperation,
    undoMerge,
    mergeOperationInto,
    mergeExistingOperation,
    deleteOperation,
  } = createIncidentActions(board)

  // Prefer the server-computed labels (location_display) so first paint shows
  // the final string; the client formatter only covers addresses the server
  // hasn't labelled (optimistic local ops, free-form strings).
  const serverLocationLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const op of operations) {
      if (op.locationDisplay !== undefined) labels.set(op.location, op.locationDisplay)
    }
    return labels
  }, [operations])

  const formatLocation = useCallback((fullAddress: string): string => {
    const serverLabel = serverLocationLabels.get(fullAddress)
    if (serverLabel !== undefined) return serverLabel
    return formatLocationForDisplay(fullAddress, homeCity)
  }, [serverLocationLabels, homeCity])

  // ⚠️ The value below is memoised: ~40 components read this context, and an
  // unmemoised object re-rendered every one of them whenever this provider
  // rendered for ANY reason — including the personnel/materials providers'
  // own loading flips on every reload. The actions close over this render's
  // state and are rebuilt each render, so consumers get stable wrappers that
  // always call the LATEST render's version (never a stale closure either).
  const latestActionsRef = useRef<BoardActions | null>(null)
  latestActionsRef.current = {
    removeCrew,
    removeMaterial,
    removeVehicle,
    removeReko,
    updateOperation,
    reorderColumn,
    changeStatusToTop,
    createOperation,
    mergeOperationInto,
    mergeExistingOperation,
    undoMerge,
    getNextOperationId,
    assignPersonToOperation,
    assignRekoPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    resolveResourceConflict,
    deleteOperation,
  }
  const stableActions = useMemo<BoardActions>(() => {
    const stable = <K extends keyof BoardActions>(key: K): BoardActions[K] =>
      ((...args: unknown[]) =>
        (latestActionsRef.current![key] as (...a: unknown[]) => unknown)(...args)) as BoardActions[K]
    return {
      removeCrew: stable("removeCrew"),
      removeMaterial: stable("removeMaterial"),
      removeVehicle: stable("removeVehicle"),
      removeReko: stable("removeReko"),
      updateOperation: stable("updateOperation"),
      reorderColumn: stable("reorderColumn"),
      changeStatusToTop: stable("changeStatusToTop"),
      createOperation: stable("createOperation"),
      mergeOperationInto: stable("mergeOperationInto"),
      mergeExistingOperation: stable("mergeExistingOperation"),
      undoMerge: stable("undoMerge"),
      getNextOperationId: stable("getNextOperationId"),
      assignPersonToOperation: stable("assignPersonToOperation"),
      assignRekoPersonToOperation: stable("assignRekoPersonToOperation"),
      assignMaterialToOperation: stable("assignMaterialToOperation"),
      assignVehicleToOperation: stable("assignVehicleToOperation"),
      resolveResourceConflict: stable("resolveResourceConflict"),
      deleteOperation: stable("deleteOperation"),
    }
  }, [])

  const boardNeverLoaded = loadError !== null && lastSyncAt === null

  const value = useMemo<OperationsContextType>(
    () => ({
      personnel,
      setPersonnel,
      materials,
      setMaterials,
      operations,
      setOperations,
      homeCity,
      isLoading,
      isLoaded,
      boardNeverLoaded,
      incidentTotal,
      formatLocation,
      refreshOperations,
      setBoardDragging,
      vehicleNeedingDriver,
      clearVehicleNeedingDriver,
      requestVehicleDriver,
      resourceConflict,
      outOfServiceVehicleIds,
      materialOnSite,
      specialFunctions,
      vehicles,
      settings,
      cancelResourceConflict,
      requestResourceConflict,
      beginAssignmentSettling,
      isAssignmentSettling,
      ...stableActions,
    }),
    [
      personnel,
      setPersonnel,
      materials,
      setMaterials,
      operations,
      homeCity,
      isLoading,
      isLoaded,
      boardNeverLoaded,
      incidentTotal,
      formatLocation,
      refreshOperations,
      setBoardDragging,
      vehicleNeedingDriver,
      clearVehicleNeedingDriver,
      requestVehicleDriver,
      resourceConflict,
      outOfServiceVehicleIds,
      materialOnSite,
      specialFunctions,
      vehicles,
      settings,
      cancelResourceConflict,
      requestResourceConflict,
      beginAssignmentSettling,
      isAssignmentSettling,
      stableActions,
    ],
  )

  const syncStatus = useMemo<BoardSyncStatus>(
    () => ({ lastSyncAt, loadError, liveSince }),
    [lastSyncAt, loadError, liveSince],
  )

  return (
    <OperationsContext.Provider value={value}>
      <BoardSyncStatusContext.Provider value={syncStatus}>
        {children}
      </BoardSyncStatusContext.Provider>
      <audio ref={alertAudioRef} src="/alerts/mixkit-digital-quick-tone-2866.wav" preload="auto" />
    </OperationsContext.Provider>
  )
}

export function useOperations() {
  const context = useContext(OperationsContext)
  if (context === undefined) {
    throw new Error("useOperations must be used within an OperationsProvider")
  }
  return context
}

/** The board's sync freshness, on its own context — see `BoardSyncStatus`. */
export function useBoardSyncStatus(): BoardSyncStatus {
  const context = useContext(BoardSyncStatusContext)
  if (context === undefined) {
    throw new Error("useBoardSyncStatus must be used within an OperationsProvider")
  }
  return context
}

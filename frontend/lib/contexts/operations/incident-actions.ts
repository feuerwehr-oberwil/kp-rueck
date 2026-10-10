/**
 * Editing incidents: field edits (debounced, per-incident serial PATCH), column
 * order, status moves, create, delete + undo, and the duplicate merge/unmerge.
 * Moved verbatim out of `OperationsProvider` (see `BoardMutationContext`).
 */

import { apiClient, ApiError, type ApiIncident, type ApiIncidentCreate, type ApiIncidentUpdate } from "@/lib/api-client"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { isValidUUID } from "@/lib/utils/validation"
import type { PersonStatus } from "../personnel-context"
import type { Material } from "../materials-context"
import { toast } from "sonner"
import { toastLifetime } from "@/lib/toast-lifetime"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { decideRestoreAction, type RestoreOutcome } from "@/lib/restore-incident"
import { classifySaveFailure, fieldSaveUser, getFieldSaveScope, isFieldSaveWatched, isSavedTextField, noteFieldEdit, noteFieldSend, noteFieldSettled, type FieldSaveTicket } from "@/lib/field-save"
import { apiCoordinatesToTuple, coordinatesToApiFields } from "@/lib/coordinate-parser"
import type { Operation, OperationStatus } from "./types"
import type { BoardMutationContext } from "./board-context"

/** Columns in which an incident is being worked or wound down — reaching any of
 *  them retires the "Am Warten" flag (see `updateOperation`). Deliberately not
 *  `incoming` / `reko` / `reko_done`: an incident can legitimately sit parked in
 *  those while it waits for capacity or for the Reko to report back. */
const AM_WARTEN_CLEARING_STATUSES: OperationStatus[] = ["enroute", "active", "returning", "complete"]

/** The create payload for an operation typed into «Neuer Einsatz» — shared by
 *  the plain create and the «Zusammenführen» merge, so both send the same report. */
function operationToIncidentCreate(
  operation: Omit<Operation, "id" | "dispatchTime">,
  eventId: string,
): ApiIncidentCreate {
  return {
    event_id: eventId,
    title: operation.location,
    type: (operation.incidentType || "elementarereignis") as ApiIncidentCreate['type'],
    priority: operation.priority as "low" | "medium" | "high",
    location_address: operation.location,
    ...coordinatesToApiFields(operation.coordinates),
    status: "incoming" as const,
    description: operation.notes || null,
    contact: operation.contact || null,
    contact_phone: operation.contactPhone || null,
    internal_notes: operation.internalNotes || null,
    // Attach to an Auftrag at creation when the caller preset a group
    // (streamlined "+ Stop" flow) — backend stamps group_position.
    group_id: operation.groupId ?? null,
    // "Telefonisch gemeldet" / "Vom Feld gemeldet" on the new-emergency
    // modal. Anything else the caller might carry (a webhook slug on a
    // copied operation) is not an editor's to claim, so it collapses to
    // the operator default.
    source: (operation.source === 'intake' || operation.source === 'feld'
      ? operation.source
      : 'operator') as ApiIncidentCreate['source'],
  }
}


/** The server's 409 for «not merged (any more)» — `services/duplicates.unmerge_report`. */
const ALREADY_SEPARATED = "Diese Meldung ist nicht zusammengeführt."

export function createIncidentActions(board: BoardMutationContext) {
  const {
    operations,
    personnel,
    materials,
    isLoaded,
    selectedEvent,
    setOperations,
    setPersonnel,
    setMaterials,
    criticalUpdateInProgress,
    mutationEpochRef,
    patchQueueRef,
    updateBatcherRef,
    reorderInFlightRef,
    queuedReorderRef,
    armAssignmentCooldown,
    releaseAssignmentCooldown,
    refreshOperations,
  } = board

  const updateOperation = (operationId: string, updates: Partial<Operation>) => {
    // LocationInput clears the address and coordinates together. Normalize both
    // legacy `coordinates: undefined` and address-only clear callbacks without
    // changing updates that simply omit coordinates.
    const hasCoordinateUpdate = Object.prototype.hasOwnProperty.call(updates, "coordinates")
    const normalizedUpdates = hasCoordinateUpdate
      ? { ...updates, coordinates: updates.coordinates ?? null }
      : updates.location === ""
        ? { ...updates, coordinates: null }
        : updates
    // Moving an incident into a working or closing column means it is, by
    // definition, no longer waiting. Leaving "Am Warten" set would keep the
    // badge on the card and keep the notification thresholds treating the
    // incident as parked — so clear it here, in the one funnel every status
    // change passes through, rather than at each of the half-dozen call sites.
    // An explicit `amWarten` in the same update always wins.
    const currentOp = operations.find((op) => op.id === operationId)
    const clearsAmWarten = Boolean(
      normalizedUpdates.status &&
        AM_WARTEN_CLEARING_STATUSES.includes(normalizedUpdates.status) &&
        currentOp?.amWarten &&
        normalizedUpdates.amWarten === undefined,
    )
    const enhancedUpdates = normalizedUpdates.status
      ? { ...normalizedUpdates, statusChangedAt: new Date(), ...(clearsAmWarten ? { amWarten: false } : {}) }
      : normalizedUpdates

    // Free-text fields report their own save state under the field
    // (lib/field-save). Recorded here, in the one funnel, so the board card's
    // inline edits and the detail's are the same edit to the same field.
    if (isLoaded) {
      for (const [key, value] of Object.entries(normalizedUpdates)) {
        if (!isSavedTextField(key)) continue
        noteFieldEdit(operationId, key, String(value ?? ''), String(currentOp?.[key] ?? ''))
      }
    }
    // Whose edit this is. A write still queued when the session changes hands
    // is dropped, never sent under the next operator's login.
    const userAtEdit = fieldSaveUser(getFieldSaveScope())

    if (clearsAmWarten) {
      toast.info(translateOutsideReact('notifications.operations.amWartenClearedTitle'), {
        description: translateOutsideReact('notifications.operations.amWartenClearedDescription'),
      })
    }

    // When completing an operation, auto-release personnel and vehicles (backend does this too)
    const isCompletingOperation = normalizedUpdates.status === "complete"
    // ...and the other direction: leaving `complete` gives the crew back. The
    // backend undoes the release inside the same transaction as the status
    // change (`_undo_completion_release`), so the card is right on the server
    // the moment the PATCH returns — but the optimistic state above emptied it
    // when it was completed, and nothing local knows what was there. Refetch.
    //
    // This is the fix for the Abbrechen in every completion gate: the gate moves
    // the card first and asks afterwards, so cancelling it is a reopen.
    const isReopeningOperation = Boolean(
      normalizedUpdates.status && normalizedUpdates.status !== "complete" && currentOp?.status === "complete",
    )

    setOperations((ops) =>
      ops.map((op) => {
        if (op.id !== operationId) return op

        let updatedOp = { ...op, ...enhancedUpdates }

        // Clear crew and vehicles when completing (backend auto-releases these)
        if (isCompletingOperation) {
          updatedOp = {
            ...updatedOp,
            crew: [],
            crewAssignments: new Map(),
            vehicles: [],
            vehicleAssignments: new Map(),
            vehicleCallsigns: new Map(),
            // Keep materials - backend keeps them assigned (may be left on site)
          }
        }

        return updatedOp
      })
    )

    // Update personnel status to available when operation completes
    if (isCompletingOperation) {
      const operation = operations.find(op => op.id === operationId)
      if (operation) {
        const crewToRelease = operation.crew
        setPersonnel((people) =>
          people.map((p) => {
            if (crewToRelease.includes(p.name)) {
              // Check if still assigned to another operation
              const stillAssigned = operations.some(
                op => op.id !== operationId && op.crew.includes(p.name)
              )
              if (!stillAssigned) {
                return { ...p, status: "available" as PersonStatus }
              }
            }
            return p
          })
        )
      }
    }

    // Guard against polling overwriting optimistic updates (status changes
    // included — the hold is released only after the PATCH settles, unlike
    // the old fixed 2s status timer that could expire mid-flight). Take ONE
    // hold per pending batch: schedule() merges rapid edits into a single
    // flush, so arming on every call would leak holds and freeze syncing.
    if (isLoaded && updateBatcherRef.current.getPending(operationId) !== undefined) {
      mutationEpochRef.current++ // still invalidate in-flight reloads
    } else {
      armAssignmentCooldown()
    }

    if (isLoaded) {
      const performUpdate = async (batchedUpdates: Partial<Operation>) => {
        const apiUpdates: Partial<ApiIncidentUpdate> = {}
        if (batchedUpdates.location !== undefined) apiUpdates.location_address = batchedUpdates.location
        if (batchedUpdates.incidentType !== undefined) apiUpdates.type = batchedUpdates.incidentType as ApiIncidentUpdate['type']
        if (batchedUpdates.priority !== undefined) apiUpdates.priority = batchedUpdates.priority
        if (batchedUpdates.status !== undefined) apiUpdates.status = batchedUpdates.status
        if (batchedUpdates.coordinates !== undefined) {
          Object.assign(apiUpdates, coordinatesToApiFields(batchedUpdates.coordinates))
        }
        if (batchedUpdates.notes !== undefined) apiUpdates.description = batchedUpdates.notes
        if (batchedUpdates.contact !== undefined) apiUpdates.contact = batchedUpdates.contact
        if (batchedUpdates.contactPhone !== undefined) apiUpdates.contact_phone = batchedUpdates.contactPhone
        if (batchedUpdates.internalNotes !== undefined) apiUpdates.internal_notes = batchedUpdates.internalNotes
        if (batchedUpdates.nachbarhilfe !== undefined) apiUpdates.nachbarhilfe = batchedUpdates.nachbarhilfe
        if (batchedUpdates.nachbarhilfeNote !== undefined) apiUpdates.nachbarhilfe_note = batchedUpdates.nachbarhilfeNote
        if (batchedUpdates.amWarten !== undefined) apiUpdates.am_warten = batchedUpdates.amWarten
        if (batchedUpdates.amWartenNote !== undefined) apiUpdates.am_warten_note = batchedUpdates.amWartenNote
        if (batchedUpdates.zuFuss !== undefined) apiUpdates.zu_fuss = batchedUpdates.zuFuss
        // Provenance correction (plan 26 decision 8). Only the values an editor
        // may claim travel — operator, intake ("Telefonisch gemeldet") and feld
        // ("Vom Feld gemeldet"): a card that arrived from Divera keeps its own
        // slug, and sending it back would be a 422 on an unrelated edit.
        if (
          batchedUpdates.source === 'operator' ||
          batchedUpdates.source === 'intake' ||
          batchedUpdates.source === 'feld'
        ) {
          apiUpdates.source = batchedUpdates.source
        }

        const textFields = Object.keys(batchedUpdates).filter(isSavedTextField)
        // Only text fields, and their field is on screen: the failure is said
        // there, with the text kept and a retry next to it — a toast on top
        // would be the second red notice for one fact.
        const failureShownAtField = () =>
          textFields.length > 0 &&
          Object.keys(batchedUpdates).every(isSavedTextField) &&
          isFieldSaveWatched(operationId)
        // Filled by the queued task — a holder, because TypeScript does not
        // follow an assignment made inside the callback.
        const sent: { ticket?: FieldSaveTicket } = {}

        try {
          await patchQueueRef.current.run(
            operationId,
            async () => {
              // Signed out (or somebody else signed in) while this sat in the
              // debounce or behind an earlier PATCH: not this session's write.
              // The scope change has already dropped the drafts it carried.
              if (fieldSaveUser(getFieldSaveScope()) !== userAtEdit) return
              sent.ticket = noteFieldSend(operationId, textFields)
              await apiClient.updateIncident(operationId, apiUpdates)
            },
            // pagehide/visibility flush: leave now, the page may be gone
            // before the request ahead of this one settles.
            { jump: typeof document !== 'undefined' && document.visibilityState === 'hidden' },
          )
          if (sent.ticket) noteFieldSettled(sent.ticket, { ok: true })
          if (isReopeningOperation) await refreshOperations()
        } catch (err) {
          console.error("Failed to update operation:", err)
          if (sent.ticket) noteFieldSettled(sent.ticket, { ok: false, reason: classifySaveFailure(err) })
          if (ApiError.isConflictError(err)) {
            if (!failureShownAtField()) {
              toast.info(translateOutsideReact('notifications.operations.conflictTitle'), {
                description: translateOutsideReact('notifications.operations.conflictDescription')
              })
            }
            await refreshOperations()
          } else if (batchedUpdates.status !== undefined) {
            // Status changes are usually drag-drops between columns. If the
            // backend rejects the change, the card visually sits in the wrong
            // column until the next poll — refresh now so it snaps back.
            toast.error(translateOutsideReact('notifications.operations.statusNotChangedTitle'), {
              description: translateOutsideReact('notifications.operations.statusNotChangedDescription'),
            })
            await refreshOperations()
          } else if (!failureShownAtField()) {
            toast.error(translateOutsideReact('notifications.operations.updateFailedTitle'), { description: translateOutsideReact('notifications.operations.updateFailedDescription') })
          }
        } finally {
          if (criticalUpdateInProgress.current) criticalUpdateInProgress.current = false
          releaseAssignmentCooldown()
        }
      }

      // Location/coordinate edits and STATUS changes flush almost immediately
      // (map pin drops need to persist fast; status drags must hit the server
      // before the reorder POST lands and before a possible tab close).
      // Everything else debounces to coalesce rapid edits. Criticality is
      // decided on the MERGED batch so a follow-up non-critical edit can't
      // demote a pending critical write back to the slow path.
      const merged = { ...(updateBatcherRef.current.getPending(operationId) ?? {}), ...normalizedUpdates }
      const isCriticalUpdate =
        merged.location !== undefined || merged.coordinates !== undefined || merged.status !== undefined
      if (isCriticalUpdate) criticalUpdateInProgress.current = true
      updateBatcherRef.current.schedule(operationId, normalizedUpdates, isCriticalUpdate ? 50 : 500, performUpdate)
    } else {
      releaseAssignmentCooldown(3000)
    }
  }

  // Persist the manual order of a status column. The optimistic reorder already
  // happened in the drag handler; this writes the new positions so the next
  // reconciliation reload reproduces the same order instead of snapping the
  // card back to its old (created_at) slot. Guards reconciliation with the same
  // assignment cooldown updateOperation uses, so a poll/WS reload mid-write
  // can't clobber the optimistic order before the POST lands.
  const reorderColumn = (orderedIds: string[]) => {
    if (!isLoaded || !selectedEvent || !isValidUUID(selectedEvent.id) || orderedIds.length === 0) return

    // Serialize the POSTs: two rapid drags in flight together can commit in
    // reverse order server-side, silently persisting the FIRST drag's order.
    // Only the latest queued order is sent once the in-flight POST settles.
    const eventId = selectedEvent.id
    queuedReorderRef.current = orderedIds
    if (reorderInFlightRef.current) return

    reorderInFlightRef.current = true
    void (async () => {
      try {
        while (queuedReorderRef.current) {
          const ids = queuedReorderRef.current
          queuedReorderRef.current = null
          armAssignmentCooldown()
          try {
            await apiClient.reorderIncidents(eventId, ids)
          } catch (err) {
            console.error("Failed to persist column order:", err)
            // The optimistic order isn't saved — tell the user and pull the
            // authoritative order back (the generic API toast doesn't say the
            // ORDER was reverted).
            toast.error(translateOutsideReact('notifications.operations.reorderFailedTitle'), {
              description: translateOutsideReact('notifications.operations.reorderFailedDescription'),
            })
            await refreshOperations()
          } finally {
            releaseAssignmentCooldown()
          }
        }
      } finally {
        reorderInFlightRef.current = false
      }
    })()
  }

  // One-click status change that drops the card at the TOP of its new column,
  // mirroring how the reko auto-advance surfaces freshly-moved incidents. Saves
  // the operator a drag across the board.
  const changeStatusToTop = (
    operationId: string,
    newStatus: OperationStatus,
    /** Merged into the same update. Used by the workflow gates to put back a
     *  flag their move cleared, so cancelling a gate really is a no-op. */
    extraUpdates?: Partial<Operation>,
  ) => {
    // Persist the status (debounced backend update + completion side effects).
    updateOperation(operationId, { status: newStatus, ...extraUpdates })
    // Optimistically move the card to the front of the array so it renders at the
    // top of its (single-status) column immediately.
    setOperations((ops) => {
      const target = ops.find((o) => o.id === operationId)
      if (!target) return ops
      return [target, ...ops.filter((o) => o.id !== operationId)]
    })
    // Persist the new in-column order with this card first.
    const ids = [
      operationId,
      ...operations
        .filter((o) => o.id !== operationId && o.status === newStatus)
        .map((o) => o.id),
    ]
    reorderColumn(ids)
  }

  const getNextOperationId = () => {
    const maxId = Math.max(...operations.map(op => parseInt(op.id) || 0))
    return String(maxId + 1)
  }

  const createOperation = async (operation: Omit<Operation, "id" | "dispatchTime">) => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      console.error("Cannot create operation without valid selected event")
      return
    }

    if (isLoaded) {
      try {
        const incidentData = operationToIncidentCreate(operation, selectedEvent.id)

        const apiIncident = await apiClient.createIncident(incidentData)

        const newOperation: Operation = {
          id: apiIncident.id,
          location: apiIncident.location_address || apiIncident.title,
          locationDisplay: apiIncident.location_display ?? undefined,
          vehicle: operation.vehicle,
          vehicles: [],
          incidentType: operation.incidentType,
          dispatchTime: new Date(apiIncident.created_at),
          crew: [],
          priority: apiIncident.priority as "low" | "medium" | "high",
          status: "incoming",
          coordinates: apiCoordinatesToTuple(apiIncident.location_lat, apiIncident.location_lng),
          materials: [],
          notes: apiIncident.description || "",
          contact: apiIncident.contact || "",
          contactPhone: apiIncident.contact_phone || "",
          internalNotes: apiIncident.internal_notes || "",
          nachbarhilfe: apiIncident.nachbarhilfe || false,
          nachbarhilfeNote: apiIncident.nachbarhilfe_note || "",
          amWarten: apiIncident.am_warten || false,
          amWartenNote: apiIncident.am_warten_note || "",
          zuFuss: apiIncident.zu_fuss || false,
          source: apiIncident.source || "operator",
          fromRealAlarm: apiIncident.from_real_alarm ?? false,
          statusChangedAt: apiIncident.status_changed_at ? new Date(apiIncident.status_changed_at) : null,
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
          groupId: apiIncident.group_id ?? null,
          groupPosition: apiIncident.group_position ?? 0,
          number: apiIncident.number ?? null,
        }
        // Invalidate reloads that started before the POST landed — they'd
        // overwrite the board without the new incident.
        mutationEpochRef.current++
        // A WS-triggered reload can already have delivered this incident
        // between the POST and this write — don't render it twice.
        setOperations((ops) =>
          ops.some((op) => op.id === newOperation.id) ? ops : [newOperation, ...ops]
        )
      } catch (error) {
        console.error("Failed to create operation:", error)
        toast.error(translateOutsideReact('notifications.operations.createFailedTitle'), {
          description: translateOutsideReact('notifications.operations.createFailedDescription'),
        })
      }
    } else {
      const newOperation: Operation = {
        ...operation,
        id: getNextOperationId(),
        dispatchTime: new Date(),
        nachbarhilfe: operation.nachbarhilfe || false,
        statusChangedAt: null,
        hasCompletedReko: false,
        rekoArrivedAt: null,
        rekoSummary: null,
        leaderName: null,
        crewAssignments: new Map(),
        materialAssignments: new Map(),
        vehicleAssignments: new Map(),
        vehicleCallsigns: new Map(),
      }
      setOperations((ops) => [newOperation, ...ops])
    }
  }


  // Undo a delete: restore the soft-deleted incident and reconcile the board.
  // api-client's request() returns undefined on a network error (no throw) and
  // throws an ApiError (409 → isConflictError) on HTTP failures, so we normalize
  // both into a RestoreOutcome and let the pure decideRestoreAction map it.
  const handleRestore = async (operationId: string): Promise<void> => {
    let outcome: RestoreOutcome
    try {
      const restored = await apiClient.restoreIncident(operationId)
      outcome = restored ? "ok" : "network"
    } catch (err) {
      outcome = ApiError.isConflictError(err) ? "conflict" : "error"
    }

    const action = decideRestoreAction(outcome)
    if (action === "error") {
      toast.error(translateOutsideReact('notifications.operations.restoreFailedTitle'), {
        description: translateOutsideReact('notifications.operations.restoreFailedDescription'),
      })
      return
    }

    // A restore always re-includes the card on the next load, so there is no
    // WS-resurrection suppression to bypass — refresh pulls the card back.
    await refreshOperations()
    if (action === "refresh-success") {
      toast.success(translateOutsideReact('notifications.operations.restoredTitle'))
    }
  }

  // --- Duplicate reports (services/duplicates.py) ---
  //
  // Every merge is undoable: the report row survives on the server (hidden,
  // `merged_into_id`), so «Rückgängig» on the toast and «Trennen» in the
  // target's Verlauf both call the same unmerge.

  const undoMerge = async (mergedIncidentId: string): Promise<boolean> => {
    try {
      const result = await apiClient.unmergeIncident(mergedIncidentId)
      mutationEpochRef.current++
      await refreshOperations()
      toast.success(translateOutsideReact('duplicates.unmergedTitle'), {
        description: result.note_removed ? undefined : translateOutsideReact('duplicates.noteKept'),
      })
      return true
    } catch (err) {
      if (ApiError.isConflictError(err)) {
        await refreshOperations()
        // Already separated (a second click, or another board was faster): quiet.
        if (err.message === ALREADY_SEPARATED) return true
        // A refusal the server put into words — the card it went into is closed,
        // or was merged on itself (R2 review): the operator has to read why.
        toast.error(translateOutsideReact('duplicates.unmergeFailed'), { description: err.message })
        return false
      }
      console.error("Failed to unmerge:", err)
      toast.error(translateOutsideReact('duplicates.unmergeFailed'))
      return false
    }
  }

  const announceMerge = (targetLabel: string, mergedIncidentId: string) => {
    toast(translateOutsideReact('duplicates.mergedTitle', { label: targetLabel }), {
      description: translateOutsideReact('duplicates.mergedDescription'),
      // a bare toast() bypasses the lifetime wrappers — carry the line itself
      ...toastLifetime(8000),
      action: {
        label: translateOutsideReact('duplicates.undo'),
        onClick: () => {
          void undoMerge(mergedIncidentId)
        },
      },
    })
  }

  const targetLabelFor = (targetId: string, fallback: ApiIncident): string => {
    const target = operations.find((op) => op.id === targetId)
    return target
      ? getIncidentRefLabel(target)
      : fallback.location_display || fallback.location_address || fallback.title
  }

  const mergeFailed = (err: unknown) => {
    console.error("Failed to merge:", err)
    // A refusal the server put into words (crew already on the card, card no
    // longer open) is worth more than the generic line.
    // Any other HTTP failure was already toasted by the transport.
    if (err instanceof ApiError && !ApiError.isConflictError(err)) return
    const detail = err instanceof ApiError ? err.message : undefined
    toast.error(translateOutsideReact('duplicates.mergeFailed'), { description: detail })
  }

  const mergeOperationInto = async (
    operation: Omit<Operation, "id" | "dispatchTime">,
    targetId: string,
  ): Promise<boolean> => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) return false
    try {
      const result = await apiClient.mergeReport(targetId, operationToIncidentCreate(operation, selectedEvent.id))
      mutationEpochRef.current++
      await refreshOperations()
      announceMerge(targetLabelFor(targetId, result.target), result.merged_incident_id)
      return true
    } catch (err) {
      mergeFailed(err)
      return false
    }
  }

  const mergeExistingOperation = async (operationId: string, targetId: string): Promise<boolean> => {
    try {
      const result = await apiClient.mergeIncidentInto(operationId, targetId)
      mutationEpochRef.current++
      setOperations((ops) => ops.filter((op) => op.id !== operationId))
      await refreshOperations()
      announceMerge(targetLabelFor(targetId, result.target), result.merged_incident_id)
      return true
    } catch (err) {
      mergeFailed(err)
      return false
    }
  }

  const deleteOperation = async (operationId: string): Promise<void> => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) {
      console.error("Operation not found:", operationId)
      return
    }

    try {
      if (isLoaded) {
        await apiClient.deleteIncident(operationId)
      }

      for (const crewName of operation.crew) {
        const person = personnel.find(p => p.name === crewName)
        if (person) {
          const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
          if (!stillAssigned) {
            setPersonnel((people) =>
              people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p))
            )
          }
        }
      }

      for (const materialId of operation.materials) {
        const material = materials.find(m => m.id === materialId)
        if (material) {
          const stillAssigned = operations.some(op => op.id !== operationId && op.materials.includes(materialId))
          if (!stillAssigned) {
            setMaterials((mats) =>
              mats.map((m) => (m.id === material.id ? { ...m, status: "available" as Material["status"] } : m))
            )
          }
        }
      }

      // Invalidate reloads that started before the DELETE landed — they'd
      // resurrect the card until the next sync.
      mutationEpochRef.current++
      setOperations((ops) => ops.filter((op) => op.id !== operationId))

      // Offer an undo. Only when the delete was persisted (isLoaded) — a purely
      // local optimistic delete has no backend row to restore.
      if (isLoaded) {
        toast(translateOutsideReact('notifications.operations.deletedTitle'), {
          description: getIncidentRefLabel(operation),
          // a bare toast() bypasses the lifetime wrappers — carry the line itself
          ...toastLifetime(8000),
          action: {
            label: translateOutsideReact('notifications.operations.undoLabel'),
            onClick: () => {
              void handleRestore(operationId)
            },
          },
        })
      }
    } catch (error) {
      console.error("Failed to delete operation:", error)
      throw error
    }
  }

  return {
    updateOperation,
    reorderColumn,
    changeStatusToTop,
    getNextOperationId,
    createOperation,
    undoMerge,
    mergeOperationInto,
    mergeExistingOperation,
    deleteOperation,
  }
}

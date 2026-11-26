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
import { undoToast } from "@/lib/toast-undo"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { restoreDeletedIncident } from "@/lib/restore-incident"
import { classifySaveFailure, fieldSaveUser, getFieldSaveScope, isFieldSaveWatched, isSavedTextField, noteFieldEdit, noteFieldQueued, noteFieldSend, noteFieldSettled, textConflictOf, type FieldSaveTicket } from "@/lib/field-save"
import { coordinatesToApiFields } from "@/lib/coordinate-parser"
import { reportStatusConflict } from "@/lib/status-conflict"
import type { Operation, OperationStatus, StatusWriteGuard } from "./types"
import { apiIncidentToOperation } from "./mapping"
import type { BoardMutationContext } from "./board-context"

/** Columns in which an incident is being worked or wound down — reaching any of
 *  them retires the "Am Warten" flag (see `updateOperation`). Deliberately not
 *  `incoming` / `reko` / `reko_done`: an incident can legitimately sit parked in
 *  those while it waits for capacity or for the Reko to report back. */
const AM_WARTEN_CLEARING_STATUSES: OperationStatus[] = ["enroute", "active", "returning", "complete"]

/** How long `updateOperation` gathers edits of one incident before it sends them: a
 *  move or status change goes out almost at once, typed text after a pause. */
export const EDIT_DEBOUNCE_MS = { critical: 50, text: 500 } as const

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


/** The server's code for «not merged (any more)» — `services/duplicates.unmerge_report`. */
const NOT_MERGED_CODE = "incident_not_merged"

export function createIncidentActions(board: BoardMutationContext) {
  const {
    operations,
    personnel,
    materials,
    isLoaded,
    selectedEvent,
    selectedEventIdRef,
    setOperations,
    setPersonnel,
    setMaterials,
    criticalUpdateInProgress,
    mutationEpochRef,
    patchQueueRef,
    updateBatcherRef,
    statusGuardRef,
    reorderInFlightRef,
    queuedReorderRef,
    armAssignmentCooldown,
    releaseAssignmentCooldown,
    refreshOperations,
  } = board

  const updateOperation = (operationId: string, updates: Partial<Operation>, confirm?: Required<StatusWriteGuard>) => {
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
    const scopeAtEdit = getFieldSaveScope()
    const userAtEdit = fieldSaveUser(scopeAtEdit)

    // A status move says which status this board showed, so the server can refuse
    // it when somebody else moved the card first (lib/status-conflict.ts). Taken at
    // the FIRST status edit of a batch: two quick moves merge into one PATCH, and
    // that PATCH starts where the first one did.
    if (isLoaded && normalizedUpdates.status !== undefined && currentOp) {
      if (confirm) statusGuardRef.current.set(operationId, confirm)
      else if (!statusGuardRef.current.has(operationId)) statusGuardRef.current.set(operationId, { seen: currentOp.status })
    }

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
            vehicles: [],
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
        const crewToRelease = new Set(operation.crew.map((m) => m.personnelId))
        setPersonnel((people) =>
          people.map((p) => {
            if (crewToRelease.has(p.id)) {
              // Check if still assigned to another operation
              const stillAssigned = operations.some(
                op => op.id !== operationId && op.crew.some((m) => m.personnelId === p.id)
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
        const statusGuard = batchedUpdates.status !== undefined ? statusGuardRef.current.get(operationId) : undefined
        statusGuardRef.current.delete(operationId)
        const apiUpdates: Partial<ApiIncidentUpdate> = {}
        if (batchedUpdates.location !== undefined) apiUpdates.location_address = batchedUpdates.location
        if (batchedUpdates.incidentType !== undefined) apiUpdates.type = batchedUpdates.incidentType as ApiIncidentUpdate['type']
        if (batchedUpdates.priority !== undefined) apiUpdates.priority = batchedUpdates.priority
        if (batchedUpdates.status !== undefined) apiUpdates.status = batchedUpdates.status
        if (statusGuard) {
          apiUpdates.from_status = statusGuard.seen
          if (statusGuard.override) apiUpdates.override_status = statusGuard.override
        }
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
        const sentTexts = Object.fromEntries(textFields.map((field) => [field, String(batchedUpdates[field] ?? '')]))
        // Only text fields, and their field is on screen: the failure is said
        // there, with the text kept and a retry next to it — a toast on top
        // would be the second red notice for one fact.
        const failureShownAtField = () =>
          textFields.length > 0 &&
          Object.keys(batchedUpdates).every(isSavedTextField) &&
          isFieldSaveWatched(operationId)
        // Which edit of which field this batch carries, pinned now – not when
        // it leaves the queue, by which time newer keystrokes may be pending.
        const queued = noteFieldQueued(operationId, sentTexts, scopeAtEdit)
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
              sent.ticket = noteFieldSend(queued)
              const { textBase } = sent.ticket
              await apiClient.updateIncident(
                operationId,
                Object.keys(textBase).length > 0 ? { ...apiUpdates, text_base: textBase } : apiUpdates,
              )
            },
          )
          if (sent.ticket) noteFieldSettled(sent.ticket, { ok: true })
          if (isReopeningOperation) await refreshOperations()
        } catch (err) {
          // A 409 is somebody else's newer write – an answer the UI states, not a fault to log.
          if (!ApiError.isConflictError(err)) console.error("Failed to update operation:", err)
          if (sent.ticket) {
            noteFieldSettled(sent.ticket, { ok: false, reason: classifySaveFailure(err), conflict: textConflictOf(err) })
          }
          if (
            statusGuard &&
            batchedUpdates.status !== undefined &&
            reportStatusConflict(err, { operationId, seen: statusGuard.seen, wanted: batchedUpdates.status })
          ) {
            // Somebody else moved the card first; nothing changed on the server.
            // «Gerade geändert» asks – the card goes back to where the server has it.
            await refreshOperations()
          } else if (ApiError.isConflictError(err)) {
            if (!failureShownAtField()) {
              toast.info(translateOutsideReact('notifications.operations.conflictTitle'), {
                description: translateOutsideReact('notifications.operations.conflictDescription')
              })
            }
            await refreshOperations()
          } else if (batchedUpdates.status !== undefined) {
            // Status changes are usually drag-drops between columns. If the
            // backend rejects the change, the card visually sits in the wrong
            // column until the next poll — refresh now so it snaps back. «Zurückgesetzt»
            // only once that reload is on screen: a failed one leaves the card where
            // it was dropped, and the toast must not say otherwise.
            const title = translateOutsideReact('notifications.operations.statusNotChangedTitle')
            const toastId = toast.error(title)
            const reset = await refreshOperations()
            toast.error(title, {
              id: toastId,
              description: translateOutsideReact(
                reset
                  ? 'notifications.operations.statusNotChangedDescription'
                  : 'notifications.operations.statusNotChangedStaleDescription',
              ),
            })
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
      updateBatcherRef.current.schedule(operationId, normalizedUpdates, isCriticalUpdate ? EDIT_DEBOUNCE_MS.critical : EDIT_DEBOUNCE_MS.text, performUpdate)
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

  const createOperation = async (operation: Omit<Operation, "id" | "dispatchTime">): Promise<boolean> => {
    if (!selectedEvent || !isValidUUID(selectedEvent.id)) {
      console.error("Cannot create operation without valid selected event")
      return false
    }

    // Always to the server, also while the board is still loading (an Ereignis switch): a
    // card kept only in local state would vanish with the next load, and the modal would
    // already have emptied the report on the strength of it.
    try {
      const eventId = selectedEvent.id
      const apiIncident = await apiClient.createIncident(operationToIncidentCreate(operation, eventId))
      // The board switched Ereignis while the POST was out: the incident exists in
      // the old one, so it must not land in this list, nor bump the epoch and
      // throw away the new Ereignis's first load.
      if (selectedEventIdRef.current !== eventId) return true

      const newOperation = apiIncidentToOperation(apiIncident)
      // Invalidate reloads that started before the POST landed — they'd
      // overwrite the board without the new incident.
      mutationEpochRef.current++
      // A WS-triggered reload can already have delivered this incident
      // between the POST and this write — don't render it twice.
      setOperations((ops) =>
        ops.some((op) => op.id === newOperation.id) ? ops : [newOperation, ...ops]
      )
      return true
    } catch (error) {
      console.error("Failed to create operation:", error)
      toast.error(translateOutsideReact('notifications.operations.createFailedTitle'), {
        description: translateOutsideReact('notifications.operations.createFailedDescription'),
      })
      return false
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
        if (err.code === NOT_MERGED_CODE) return true
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
    undoToast(translateOutsideReact('duplicates.mergedTitle', { label: targetLabel }), {
      description: translateOutsideReact('duplicates.mergedDescription'),
      onUndo: () => undoMerge(mergedIncidentId),
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

      for (const { personnelId } of operation.crew) {
        const person = personnel.find(p => p.id === personnelId)
        if (person) {
          const stillAssigned = operations.some(op => op.id !== operationId && op.crew.some((m) => m.personnelId === personnelId))
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
      // local optimistic delete has no backend row to restore. There is no
      // «wirklich löschen?» before this (owner, 17.11.2026): the toast is the
      // safety net, so it also says what the card took off the board with it –
      // a card that was never an incident usually had people and a vehicle on it.
      // The server keeps those assignments on the soft-deleted row; the undo
      // brings them back with the card.
      if (isLoaded) {
        const released = [
          operation.crew.length ? translateOutsideReact('kanban.common.personCount', { count: operation.crew.length }) : null,
          operation.vehicles.length ? operation.vehicles.map((v) => v.name).join(', ') : null,
        ].filter(Boolean)
        undoToast(translateOutsideReact('notifications.operations.deletedTitle'), {
          description: [
            getIncidentRefLabel(operation),
            released.length ? translateOutsideReact('kanban.common.deleteIncidentReleases', { what: released.join(', ') }) : null,
          ].filter(Boolean).join(' · '),
          onUndo: () => restoreDeletedIncident(operationId, refreshOperations),
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

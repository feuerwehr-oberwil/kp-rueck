'use client'

/**
 * «Blumenweg 21 als Stopp in Auftrag Nord aufnehmen?» – a vehicle that drives an Auftrag is
 * being assigned to a lone Einsatz (owner pick #23, 19.11.2026). The usual reading is «that
 * Einsatz belongs on the route», so the question offers that first; «Nur zusätzlich zuweisen»
 * is the plain double booking. Every vehicle path that ends on an ungrouped Einsatz asks it
 * (number keys, picker, drag-drop – `assignVehicleToIncidentWithConflict`), and
 * `components/auftrag-stop-prompt.tsx`, mounted once in the root layout, answers it.
 */

import { useSyncExternalStore } from 'react'

export interface AuftragStopQuestion {
  groupId: string
  groupName: string
  incidentId: string
  incidentLabel: string
  vehicleName: string
  /** «Nur zusätzlich zuweisen»: the vehicle onto the Einsatz as well, the Auftrag untouched. */
  assignOnly: () => Promise<unknown> | unknown
}

// One open question at a time; the newest wins, like the status conflict.
let open: AuftragStopQuestion | null = null
const listeners = new Set<() => void>()

function emit(next: AuftragStopQuestion | null) {
  open = next
  for (const listener of listeners) listener()
}

/** Ask it. The prompt closes it through `closeAuftragStop` once an answer went through. */
export function askAuftragStop(question: AuftragStopQuestion) {
  emit(question)
}

export function closeAuftragStop() {
  emit(null)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The open question, or null – for the prompt. */
export function useAuftragStopQuestion(): AuftragStopQuestion | null {
  return useSyncExternalStore(subscribe, () => open, () => null)
}

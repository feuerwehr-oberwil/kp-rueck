"use client"

import { useContext } from "react"
import { OperationsContext } from "./operations/contexts"

// Types
/**
 * The three states a person can be in on the board.
 *
 * `available` / `unavailable` is what the API stores on `Personnel.status` — «im Dienst /
 * nicht im Dienst», the same field vehicles and materials have. `assigned` is never stored:
 * it is derived per event from `incident_assignments` and written onto the person by
 * operations-context.
 *
 * `unavailable` used to be missing here while the API mapping cast the raw field to this
 * type anyway — so an off-duty person carried a value the type said could not exist.
 */
export type PersonStatus = "available" | "assigned" | "unavailable"
export type PersonRole = string

export interface Person {
  id: string
  name: string
  /** Tells two people of the same name apart; shown only for namesakes
   *  (`components/person-name.tsx`). */
  kennung?: string | null
  role: PersonRole
  status: PersonStatus
  tags?: string[]
  isReko?: boolean
  /**
   * On an Auftrag's crew. Set by the board from the groups context, not by the
   * operations context — a route assignment lives on the group, and
   * `GroupsProvider` sits INSIDE `OperationsProvider`, so the reconciliation
   * that produces `status` cannot see it. Same reasoning as `isReko`: the
   * person is spoken for without being on any incident's `crew`.
   */
  isOnAuftrag?: boolean
  isDriver?: boolean
  driverVehicleId?: string
  driverVehicleName?: string
  isMagazin?: boolean
  isTelefondienst?: boolean
  isKommandoposten?: boolean
  roleSortOrder: number
  /** Whether the person is linked to Divera (addressable for outbound alarms). */
  diveraLinked?: boolean
  /**
   * When they checked in for this Ereignis (ISO). Time on duty runs from here —
   * never from the current assignment, which a move resets (lib/crew-duty.ts).
   */
  checkedInAt?: string | null
}

/**
 * The checked-in roster of the selected Ereignis, reconciled by the board load
 * (who is on which Einsatz). A selector over the board provider – the roster is
 * its state (`lib/contexts/operations/use-resource-lists.ts`), not a provider of
 * its own any more.
 *
 * `refreshPersonnel()` writes the raw list (no board reconciliation) until the
 * next board load – the attendance dialog uses it right after a check-in.
 */
export function usePersonnel() {
  const context = useContext(OperationsContext)
  if (context === undefined) {
    throw new Error("usePersonnel must be used within an OperationsProvider")
  }
  return { personnel: context.personnel, refreshPersonnel: context.refreshPersonnel }
}

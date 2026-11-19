"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { Binoculars, MonitorCog, Phone, Truck, Warehouse } from "lucide-react"
import type { PersonWhere, TileRole } from "@/components/kanban/assignment-list-section"
import type { Operation } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { getIncidentRefLabel } from "@/lib/incident-types"

/** What `PersonTileLine` shows after the rank: where the person is, and what else they hold. */
export type PersonTileFacts = { where: PersonWhere | null; roles: TileRole[] }

type FactsOptions = {
  /** Where the person is bound besides here (an Einsatz or Auftrag) – the picker works it out,
   *  because only it knows what «here» is. Beats every place-like role. */
  elsewhere: PersonWhere | null
  /** Reko although the person row does not say so yet (the board's own Reko ids). */
  isReko?: boolean
  /** The picker only lists Reko people («Rekos übertragen»): «Reko» on every tile is noise. */
  omitReko?: boolean
  /** The picker chooses the driver of THIS vehicle: driving it says nothing new («aktuell»
   *  does), and driving ANOTHER vehicle is a place – taking the person moves them off it. */
  driverFor?: string
}

/**
 * The one «where · roles» rule of every person tile (crew grid, Fahrer, Reko pickers): the
 * Ereignis roles a person holds – Reko, Magazin, Telefondienst, KP, the driven vehicle last –
 * and where they are. `elsewhere` (an Einsatz/Auftrag) wins the where slot; otherwise the first
 * role that IS a place takes it. The driven vehicle is not a place, except in the Fahrer picker
 * (`driverFor`). Facts only – a picker never refuses a person because of them.
 *
 * Returns a function so a list renders every tile through the same translations.
 */
export function usePersonTileFacts(): (person: Person, options: FactsOptions) => PersonTileFacts {
  const t = useTranslations("kanban")
  const tDriver = useTranslations("incidents.driver")
  return useCallback((person, { elsewhere, isReko, omitReko, driverFor }) => {
    const held: (TileRole & { place: boolean })[] = []
    if (!omitReko && (person.isReko || isReko)) held.push({ label: t("common.reko"), Icon: Binoculars, place: true })
    if (person.isMagazin) held.push({ label: t("common.magazin"), Icon: Warehouse, place: true })
    if (person.isTelefondienst) held.push({ label: t("common.telefondienst"), Icon: Phone, place: true })
    if (person.isKommandoposten) held.push({ label: t("common.kommandoposten"), Icon: MonitorCog, place: true })
    if (person.isDriver && !(driverFor && person.driverVehicleId === driverFor)) {
      const vehicle = person.driverVehicleName || t("assignmentDialog.driverBadge")
      held.push(driverFor
        ? { label: tDriver("drivesVehicle", { vehicle }), Icon: Truck, place: true }
        : { label: vehicle, Icon: Truck, place: false })
    }
    const placeRole = elsewhere ? undefined : held.find((role) => role.place)
    return {
      where: elsewhere ?? (placeRole ? { head: placeRole.label, full: placeRole.label, Icon: placeRole.Icon } : null),
      roles: held.filter((role) => role !== placeRole).map(({ label, Icon }) => ({ label, Icon })),
    }
  }, [t, tDriver])
}

/** The Einsätze a person is on the crew of, as a where-note («Hauptstrasse 5 +1»), or null. */
export function einsatzWhere(personId: string, operations: readonly Operation[]): PersonWhere | null {
  const labels = operations
    .filter((op) => op.crew.some((member) => member.personnelId === personId))
    .map((op) => getIncidentRefLabel(op, 40))
  if (labels.length === 0) return null
  return { head: labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : labels[0], full: labels.join(", ") }
}

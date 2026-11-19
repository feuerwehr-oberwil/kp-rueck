"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { Binoculars, MonitorCog, Phone, Truck, Warehouse } from "lucide-react"
import type { PersonWhere, TileRole } from "@/components/kanban/assignment-list-section"
import type { Operation } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { formatDuration } from "@/lib/duration"
import { formatTime } from "@/lib/format-time"
import { minutesUntil, planFact } from "@/lib/planned-times"

/**
 * The person's plan on the tile: «bis 22:00» (amber when `soon`) or «ab 20:00», and – for a
 * person leaving within `PLAN_SOON_MINUTES` – the advice the tile shows once ticked. Advice
 * only: a picker never refuses anybody for it.
 */
export type TilePlan = { label: string; soon: boolean; advice: string | null }

/** What `PersonTileLine` shows after the rank: where the person is, what else they hold, until when. */
export type PersonTileFacts = { where: PersonWhere | null; roles: TileRole[]; plan: TilePlan | null }

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
 * The one «where · roles · bis» rule of every person tile (crew grid, Fahrer, Reko pickers): the
 * Ereignis roles a person holds – Reko, Magazin, Telefondienst, KP, the driven vehicle last –
 * where they are, and their plan («bis 22:00», `planned_until` from the Appell / check-in).
 * `elsewhere` (an Einsatz/Auftrag) wins the where slot; otherwise the first role that IS a
 * place takes it. The driven vehicle is not a place, except in the Fahrer picker
 * (`driverFor`). Facts only – a picker never refuses a person because of them.
 *
 * Returns a function so a list renders every tile through the same translations.
 */
export function usePersonTileFacts(): (person: Person, options: FactsOptions) => PersonTileFacts {
  const t = useTranslations("kanban")
  const tDriver = useTranslations("incidents.driver")
  const tPick = useTranslations("common.personPick")
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
      plan: tilePlan(person, Date.now(), tPick),
    }
  }, [t, tDriver, tPick])
}

/** `TilePlan` at `now`, in the `common.personPick` copy. */
export function tilePlan(
  person: Pick<Person, "plannedFrom" | "plannedUntil">,
  now: number,
  t: (key: string, values?: Record<string, string>) => string,
): TilePlan | null {
  const fact = planFact(person, now)
  if (!fact) return null
  const time = formatTime(fact.at)
  if (fact.kind === "from") return { label: t("planFrom", { time }), soon: false, advice: null }
  const left = minutesUntil(fact.at, now) ?? 0
  return {
    label: t("planUntil", { time }),
    soon: fact.soon,
    advice: !fact.soon
      ? null
      : left > 0
        ? t("leavesSoon", { time, duration: formatDuration(left * 60_000) })
        : t("leftAlready", { time }),
  }
}

/** The Einsätze a person is on the crew of, as a where-note («Hauptstrasse 5 +1»), or null. */
export function einsatzWhere(personId: string, operations: readonly Operation[]): PersonWhere | null {
  const labels = operations
    .filter((op) => op.crew.some((member) => member.personnelId === personId))
    .map((op) => getIncidentRefLabel(op, 40))
  if (labels.length === 0) return null
  return { head: labels.length > 1 ? `${labels[0]} +${labels.length - 1}` : labels[0], full: labels.join(", ") }
}

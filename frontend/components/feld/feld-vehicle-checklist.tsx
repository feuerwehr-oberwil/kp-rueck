'use client'

/**
 * The Fahrzeuge section of the Schadenplatz-Rapport: one chip per vehicle that
 * was there («Pio · Dürring Jan», the Ereignis's driver muted), a ✕ to take it
 * out, a dashed «+ Fahrzeug» to add one (owner pick 1B, 24.11.2026).
 *
 * **Confirm what the board disponiert, add everything else through one
 * picker.** The whole fleet used to get a row (§18.33), which made the rapport a
 * fleet inventory with a question stapled to every vehicle: a station with
 * twelve answered eleven questions nobody had a reason to ask, and the one
 * vehicle that actually rolled was as easy to overlook as the eleven that did
 * not. §18.33 was right that the board is behind reality in both directions — a
 * vehicle drives along that nobody assigned — but that is the exception
 * «+ Fahrzeug» (`FeldAddPicker`, the rest of the fleet) exists for.
 *
 * A ✕ sets `present: false`, the «nein» unticking «war dabei» used to say — same
 * data, same reason as in the Mannschaft section. The vehicle shows up again in
 * «+ Fahrzeug» (under «Disponiert» when the board sent it), which is how a
 * removal is taken back.
 *
 * No free-text vehicle: a row is keyed on a fleet `vehicle_id`
 * (`RapportVehicleRow`), so there is nothing to store a typed name in. Adding a
 * vehicle still creates no assignment.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { FeldAddPicker, type FeldAddPickerItem } from '@/components/feld/feld-add-picker'
import { FeldChip, FeldChipList } from '@/components/feld/feld-chip'
import type { ApiRapportVehicleCandidate, ApiRapportVehicleRow } from '@/lib/api/types'

interface FeldVehicleChecklistProps {
  rows: ApiRapportVehicleRow[]
  /** The rest of the fleet. The server leaves out anything that already has a row. */
  candidates?: ApiRapportVehicleCandidate[]
  /** Who drives each vehicle in this Ereignis, by `vehicle_id` (rapport prefill). */
  drivers?: Record<string, string>
  disabled?: boolean
  onChange: (rows: ApiRapportVehicleRow[]) => void
}

export function FeldVehicleChecklist({ rows, candidates = [], drivers = {}, disabled, onChange }: FeldVehicleChecklistProps) {
  const t = useTranslations('feld.rapport.vehicles')

  /** Adds the picked vehicles — or re-ticks the row of one taken out a moment ago. */
  const add = (picked: FeldAddPickerItem[]) => {
    const ids = new Set(picked.map(item => item.key))
    const next = rows.map(row => (ids.has(row.vehicle_id) ? { ...row, present: true } : row))
    for (const item of picked) {
      if (rows.some(row => row.vehicle_id === item.key)) continue
      next.push({ vehicle_id: item.key, name: item.name, present: true, on_board: false })
    }
    onChange(next)
  }

  /**
   * The ✕ **unticks** the row rather than dropping it — same reason as in the
   * Mannschaft section: the save reconciles the payload against what is stored,
   * so a row the payload never mentions is kept, and an unticked row for a
   * vehicle nobody disponiert is never written down.
   */
  const remove = (vehicleId: string) => {
    onChange(rows.map(row => (row.vehicle_id === vehicleId ? { ...row, present: false } : row)))
  }

  const present = useMemo(() => rows.filter(row => row.present), [rows])

  // Whatever the board disponiert and the crew took out first, then the rest of
  // the fleet. An added row that was taken out again is a removal in flight and
  // is offered again – also when it was saved before: the server leaves a saved
  // hand-added vehicle out of `candidates`, so it comes from the rows.
  const pickable = useMemo((): FeldAddPickerItem[] => {
    const fleet = [
      ...candidates.filter(
        candidate => !rows.some(row => row.vehicle_id === candidate.vehicle_id && (row.on_board || row.present)),
      ),
      ...rows.filter(
        row => !row.on_board && !row.present && !candidates.some(candidate => candidate.vehicle_id === row.vehicle_id),
      ),
    ]
    return [
      ...rows
        .filter(row => row.on_board && !row.present)
        .map(row => ({ key: row.vehicle_id, name: row.name, group: t('groupDispatched') })),
      ...fleet.map(vehicle => ({ key: vehicle.vehicle_id, name: vehicle.name, group: t('groupFleet') })),
    ]
  }, [candidates, rows, t])

  return (
    <FeldChipList label={t('listLabel')}>
      {present.length === 0 && <li className="text-sm text-muted-foreground">{t('empty')}</li>}
      {present.map(row => (
        <FeldChip
          key={row.vehicle_id}
          removeLabel={t('removeAria', { name: row.name })}
          onRemove={disabled ? undefined : () => remove(row.vehicle_id)}
        >
          <span className="min-w-0 break-words">
            {row.name}
            {drivers[row.vehicle_id] && <span className="text-muted-foreground"> · {drivers[row.vehicle_id]}</span>}
          </span>
        </FeldChip>
      ))}
      {/* Nothing left in the fleet means nothing to add — and no free text to
          fall back on, so no add chip either. */}
      {!disabled && pickable.length > 0 && (
        <li>
          <FeldAddPicker
            label={t('add')}
            chipLabel={t('addChip')}
            searchPlaceholder={t('searchPlaceholder')}
            items={pickable}
            onAdd={picked => add(picked)}
          />
        </li>
      )}
    </FeldChipList>
  )
}

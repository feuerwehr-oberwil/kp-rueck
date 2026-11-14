'use client'

/**
 * The Fahrzeuge section of the Schadenplatz-Rapport.
 *
 * **Confirm what the board disponiert, add everything else through one
 * picker.** The whole fleet used to get a row (§18.33), which made the rapport a
 * fleet inventory with a question stapled to every vehicle: a station with
 * twelve answered eleven questions nobody had a reason to ask, and the one
 * vehicle that actually rolled was as easy to overlook as the eleven that did
 * not. §18.33 was right that the board is behind reality in both directions — a
 * vehicle drives along that nobody assigned — but that is the exception
 * «Fahrzeug hinzufügen» (`FeldAddPicker`, the rest of the fleet) exists for.
 *
 * No free-text vehicle: a row is keyed on a fleet `vehicle_id`
 * (`RapportVehicleRow`), so there is nothing to store a typed name in.
 *
 * Its own section, its own count. "2 Fahrzeuge" used to have to be read out of
 * "5 Personen · 1 Fahrzeug"; Mensch und Fahrzeug are not one list. Ticking or
 * adding a vehicle still creates no assignment.
 */

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Truck, X } from 'lucide-react'

import { FeldAddPicker } from '@/components/feld/feld-add-picker'
import { Button } from '@/components/ui/button'
import type { ApiRapportVehicleCandidate, ApiRapportVehicleRow } from '@/lib/api/types'

interface FeldVehicleChecklistProps {
  rows: ApiRapportVehicleRow[]
  /** The rest of the fleet. The server leaves out anything that already has a row. */
  candidates?: ApiRapportVehicleCandidate[]
  disabled?: boolean
  onChange: (rows: ApiRapportVehicleRow[]) => void
}

export function FeldVehicleChecklist({ rows, candidates = [], disabled, onChange }: FeldVehicleChecklistProps) {
  const t = useTranslations('feld.rapport.vehicles')

  const toggle = (vehicleId: string, present: boolean) => {
    onChange(rows.map(row => (row.vehicle_id === vehicleId ? { ...row, present } : row)))
  }

  /** Adds the picked vehicles — or re-ticks the rows of one removed a moment ago. */
  const add = (picked: { key: string; name: string }[]) => {
    const ids = new Set(picked.map(item => item.key))
    const next = rows.map(row => (ids.has(row.vehicle_id) ? { ...row, present: true } : row))
    for (const item of picked) {
      if (rows.some(row => row.vehicle_id === item.key)) continue
      next.push({ vehicle_id: item.key, name: item.name, present: true, on_board: false })
    }
    onChange(next)
  }

  /**
   * Removing an added row **unticks** it rather than dropping it — same reason
   * as in the Personal section: the save reconciles the payload against what is
   * stored, so a row the payload never mentions is kept, and an unticked row for
   * a vehicle nobody disponiert is never written down.
   */
  const remove = (vehicleId: string) => {
    onChange(rows.map(row => (row.vehicle_id === vehicleId ? { ...row, present: false } : row)))
  }

  // A vehicle the crew unticks stays in the first group — it was disponiert, and
  // the answer "nein, das war nicht dabei" must not make the row jump away as it
  // is given.
  //
  // An added row that has been unticked is a removal in flight (see `remove`):
  // it stays in the form so the save carries the "nein", and it shows nowhere.
  const { dispatched, added } = useMemo(() => {
    const dispatched: ApiRapportVehicleRow[] = []
    const added: ApiRapportVehicleRow[] = []
    for (const row of rows) {
      if (row.on_board) dispatched.push(row)
      else if (row.present) added.push(row)
    }
    return { dispatched, added }
  }, [rows])

  // A row that is neither disponiert nor ticked is a removal in flight — the
  // vehicle is offerable again, or a removal could not be taken back.
  const pickable = useMemo(
    () =>
      candidates
        .filter(candidate => !rows.some(row => row.vehicle_id === candidate.vehicle_id && (row.on_board || row.present)))
        .map(candidate => ({ key: candidate.vehicle_id, name: candidate.name })),
    [candidates, rows],
  )

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------- bestätigen */}
      <div className="space-y-1.5">
        {dispatched.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
            {t('empty')}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('dispatchedLabel')}</p>
            {dispatched.map(row => (
              <VehicleRow key={row.vehicle_id} row={row} disabled={disabled} onToggle={toggle} />
            ))}
          </>
        )}
      </div>

      {/* ------------------------------------------- hinzufügen */}
      <div className="space-y-2">
        {added.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('addLabel')}</p>
            {added.map(row => (
              /* No "war dabei" tick on an added row: naming a vehicle here
                 already says it was there. Taking the row away is the way back,
                 exactly as in "Weiteres gebrauchtes Material". */
              <div
                key={row.vehicle_id}
                className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words text-sm">{row.name}</span>
                </span>
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('removeAria', { name: row.name })}
                    onClick={() => remove(row.vehicle_id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Nothing left in the fleet means nothing to add — and no free text
            to fall back on, so no button either. */}
        {!disabled && pickable.length > 0 && (
          <FeldAddPicker
            label={t('add')}
            searchPlaceholder={t('searchPlaceholder')}
            items={pickable}
            onAdd={picked => add(picked)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * One disponiertes vehicle: the board's answer, with the tick that corrects it.
 *
 * No "disponiert" badge any more — every row in this block is disponiert.
 */
function VehicleRow({
  row,
  disabled,
  onToggle,
}: {
  row: ApiRapportVehicleRow
  disabled?: boolean
  onToggle: (vehicleId: string, present: boolean) => void
}) {
  const t = useTranslations('feld.rapport.vehicles')
  // The whole row is the label, so the whole row is the tap target — at least
  // 44px high on a phone; the 16px box inside it is not what a thumb aims at.
  return (
    <label className="flex max-md:min-h-11 pointer-coarse:min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words text-sm">{row.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 cursor-pointer accent-sel max-md:size-5"
          checked={row.present}
          disabled={disabled}
          aria-label={t('presentAria', { name: row.name })}
          onChange={e => onToggle(row.vehicle_id, e.target.checked)}
        />
        {t('present')}
      </span>
    </label>
  )
}

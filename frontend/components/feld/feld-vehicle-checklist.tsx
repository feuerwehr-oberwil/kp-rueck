'use client'

/**
 * The Fahrzeuge section of the Schadenplatz-Rapport.
 *
 * **Confirm what the board disponiert, search for everything else.** The whole
 * fleet used to get a row (§18.33), which made the rapport a fleet inventory
 * with a question stapled to every vehicle: a station with twelve answered
 * eleven questions nobody had a reason to ask, and the one vehicle that actually
 * rolled was as easy to overlook as the eleven that did not. §18.33 was right
 * that the board is behind reality in both directions — a vehicle drives along
 * that nobody assigned — but that is the exception this block exists for, not
 * the shape of the list. It now lives behind the search and the folded fleet.
 *
 * Its own section, its own count. "2 Fahrzeuge" used to have to be read out of
 * "5 Personen · 1 Fahrzeug"; Mensch und Fahrzeug are not one list.
 *
 * Same grammar as Personal and Material beside it: bestätigen – suchen –
 * (dort: tippen). Ticking or adding a vehicle still creates no assignment.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Plus, Truck, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
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
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  const toggle = (vehicleId: string, present: boolean) => {
    onChange(rows.map(row => (row.vehicle_id === vehicleId ? { ...row, present } : row)))
  }

  /** Adds a vehicle — or re-ticks the row of one removed a moment ago. */
  const add = (candidate: ApiRapportVehicleCandidate) => {
    if (rows.some(row => row.vehicle_id === candidate.vehicle_id)) {
      onChange(rows.map(row => (row.vehicle_id === candidate.vehicle_id ? { ...row, present: true } : row)))
      return
    }
    onChange([...rows, { vehicle_id: candidate.vehicle_id, name: candidate.name, present: true, on_board: false }])
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

  const needle = search.trim().toLowerCase()

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

  const listedCandidates = useMemo(() => {
    // A row that is neither disponiert nor ticked is a removal in flight — the
    // vehicle is offerable again, or a removal could not be taken back.
    const listed = candidates.filter(
      candidate => !rows.some(row => row.vehicle_id === candidate.vehicle_id && (row.on_board || row.present)),
    )
    if (!needle) return listed
    return listed.filter(candidate => candidate.name.toLowerCase().includes(needle))
  }, [candidates, rows, needle])

  // The fleet stays folded even with nothing disponiert — unlike the Appell in
  // the Personal section. "Kein Fahrzeug" is a normal and often correct result
  // for a Schadenplatz; "niemand war da" is not.
  const listOpen = showAll || needle.length > 0

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

      {/* ------------------------------------- suchen und ergänzen */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('addLabel')}</p>

        {added.length > 0 && (
          <div className="space-y-1.5">
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
                  <span className="truncate text-sm">{row.name}</span>
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

        {candidates.length > 0 && (
          <>
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t('searchPlaceholder')}
              disabled={disabled}
            />
            {!listOpen ? (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground"
                onClick={() => setShowAll(true)}
              >
                <ChevronDown className="h-4 w-4 shrink-0" />
                {t('showRest', { count: listedCandidates.length })}
              </button>
            ) : (
              <>
                {showAll && !needle && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-xs text-muted-foreground"
                    onClick={() => setShowAll(false)}
                  >
                    <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                    {t('hideRest')}
                  </button>
                )}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {listedCandidates.map(candidate => (
                    <button
                      key={candidate.vehicle_id}
                      type="button"
                      disabled={disabled}
                      // No aria-label — the name is the accessible name, as in
                      // the material catalogue's pick buttons.
                      onClick={() => add(candidate)}
                      className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-border/50 px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-secondary/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm">{candidate.name}</span>
                    </button>
                  ))}
                  {listedCandidates.length === 0 && (
                    <p className="col-span-full py-2 text-xs text-muted-foreground">{t('noMatch')}</p>
                  )}
                </div>
              </>
            )}
          </>
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
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{row.name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 cursor-pointer accent-primary"
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

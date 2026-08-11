'use client'

/**
 * The vehicle confirmation list.
 *
 * The crew confirms two things and nothing more: how many people were there,
 * and **which vehicles**. A count was the first shape of this and it was the
 * wrong one — "3" tells whoever retypes it nothing, three names do.
 *
 * **The whole fleet, not only the assigned ones (§18.33).** One tick per row
 * ("war dabei"), with the vehicles the board dispatched arriving ticked. The
 * earlier list could only be *unticked*, which recorded a vehicle that never
 * rolled and had no way at all to record one that came along without anybody
 * assigning it — and on a storm night the board is behind reality in both
 * directions. Same reasoning as the material catalogue above it, and ticking a
 * vehicle here still creates no assignment: `/feld` never writes one.
 *
 * **…but a 30-vehicle fleet is not a list you scroll on a phone.** Everything
 * the board dispatched, plus anything already ticked, is what the crew came here
 * to confirm — that is the list. The rest of the fleet sits behind one row and
 * is one tap away, because "a vehicle came along that nobody assigned" is the
 * exception this exists for, not the normal case. The search reaches the whole
 * fleet whether that row is open or not.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, Truck } from 'lucide-react'

import { SearchInput } from '@/components/ui/search-input'
import type { ApiRapportVehicleRow } from '@/lib/api/types'

interface FeldVehicleChecklistProps {
  rows: ApiRapportVehicleRow[]
  disabled?: boolean
  onChange: (rows: ApiRapportVehicleRow[]) => void
}

/** Above this many vehicles a station's fleet stops being scannable on a phone. */
const SEARCH_THRESHOLD = 10

export function FeldVehicleChecklist({ rows, disabled, onChange }: FeldVehicleChecklistProps) {
  const t = useTranslations('feld.rapport.vehicles')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  const toggle = (vehicleId: string, present: boolean) => {
    onChange(rows.map(row => (row.vehicle_id === vehicleId ? { ...row, present } : row)))
  }

  const needle = search.trim().toLowerCase()

  // What the crew is here to confirm: what rolled, or what it has already said
  // rolled. A vehicle the crew unticks stays in this group — it was dispatched,
  // and the answer "nein, das war nicht dabei" must not make the row jump into a
  // collapsed section the moment it is given.
  const { expected, rest } = useMemo(() => {
    const expected: ApiRapportVehicleRow[] = []
    const rest: ApiRapportVehicleRow[] = []
    for (const row of rows) (row.on_board || row.present ? expected : rest).push(row)
    return { expected, rest }
  }, [rows])

  const matches = (row: ApiRapportVehicleRow) => !needle || row.name.toLowerCase().includes(needle)

  // A ticked vehicle never hides behind a filter: the answer the crew already
  // gave has to stay visible, or it looks like it was lost.
  const visibleExpected = expected.filter(row => row.present || matches(row))
  const visibleRest = rest.filter(matches)
  // Searching is itself a request to look at the whole fleet — nothing found is
  // worse than a long list, and the crew typed a name to be shown that name.
  // A small station's fleet is a list, not a problem — it renders exactly as it
  // always did. The collapse only earns its complexity above the same threshold
  // that earns the search box.
  const collapsible = rows.length > SEARCH_THRESHOLD
  const restOpen = !collapsible || showAll || needle.length > 0 || expected.length === 0

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('label')}</p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <>
          {rows.length > SEARCH_THRESHOLD && (
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={t('searchPlaceholder')}
              disabled={disabled}
            />
          )}
          <div className="space-y-1.5">
            {visibleExpected.map(row => (
              <VehicleRow key={row.vehicle_id} row={row} disabled={disabled} onToggle={toggle} />
            ))}
          </div>

          {rest.length > 0 && (
            <div className="space-y-1.5">
              {!restOpen ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-muted-foreground"
                  onClick={() => setShowAll(true)}
                >
                  <ChevronRight className="h-4 w-4 shrink-0" />
                  {t('showRest', { count: rest.length })}
                </button>
              ) : (
                <>
                  {/* No collapse control while a search is running: the row the
                      crew searched for is in here, and hiding it again behind a
                      chevron is the opposite of what they asked for. */}
                  {showAll && !needle && expected.length > 0 && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-xs text-muted-foreground"
                      onClick={() => setShowAll(false)}
                    >
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      {t('hideRest')}
                    </button>
                  )}
                  {visibleRest.map(row => (
                    <VehicleRow key={row.vehicle_id} row={row} disabled={disabled} onToggle={toggle} />
                  ))}
                  {visibleRest.length === 0 && visibleExpected.length === 0 && (
                    <p className="px-1 py-2 text-sm text-muted-foreground">{t('noMatch')}</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

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
        {/* Which of these rows the board actually dispatched. Without it the
            list is a fleet inventory and the crew cannot see what it is
            correcting. */}
        {row.on_board && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t('dispatched')}
          </span>
        )}
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

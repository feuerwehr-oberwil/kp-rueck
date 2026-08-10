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
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Truck } from 'lucide-react'

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

  const toggle = (vehicleId: string, present: boolean) => {
    onChange(rows.map(row => (row.vehicle_id === vehicleId ? { ...row, present } : row)))
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rows
    // A ticked vehicle never hides behind a filter: the answer the crew already
    // gave has to stay visible, or it looks like it was lost.
    return rows.filter(row => row.present || row.name.toLowerCase().includes(needle))
  }, [rows, search])

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
            {visible.map(row => (
              <label
                key={row.vehicle_id}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{row.name}</span>
                  {/* Which of these rows the board actually dispatched. Without
                      it the list is a fleet inventory and the crew cannot see
                      what it is correcting. */}
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
                    onChange={e => toggle(row.vehicle_id, e.target.checked)}
                  />
                  {t('present')}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

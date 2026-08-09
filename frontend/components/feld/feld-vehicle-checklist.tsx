'use client'

/**
 * The vehicle confirmation list.
 *
 * The crew confirms two things and nothing more: how many people were there,
 * and **which vehicles**. A count was the first shape of this and it was the
 * wrong one — "3" tells whoever retypes it nothing, three names do.
 *
 * Deliberately one tick per row ("war dabei"), prefilled all-ticked: the board's
 * own assignment list is the starting point, and the crew's job is to strike out
 * what did not actually roll, not to retype the fleet. Same shape as the
 * material checklist next to it so both read the same way on a phone.
 */

import { useTranslations } from 'next-intl'
import { Truck } from 'lucide-react'

import type { ApiRapportVehicleRow } from '@/lib/api/types'

interface FeldVehicleChecklistProps {
  rows: ApiRapportVehicleRow[]
  disabled?: boolean
  onChange: (rows: ApiRapportVehicleRow[]) => void
}

export function FeldVehicleChecklist({ rows, disabled, onChange }: FeldVehicleChecklistProps) {
  const t = useTranslations('feld.rapport.vehicles')

  const toggle = (assignmentId: string, present: boolean) => {
    onChange(rows.map(row => (row.assignment_id === assignmentId ? { ...row, present } : row)))
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('label')}</p>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map(row => (
            <label
              key={row.assignment_id}
              className="flex items-center justify-between gap-3 rounded-lg bg-secondary/40 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm">{row.name}</span>
                {/* A vehicle the board dropped after the crew answered stays on
                    the slip — deleting it would lose exactly the answer this
                    list exists to capture. */}
                {!row.on_board && (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('noLongerAssigned')}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={row.present}
                  disabled={disabled}
                  aria-label={t('presentAria', { name: row.name })}
                  onChange={e => toggle(row.assignment_id, e.target.checked)}
                />
                {t('present')}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

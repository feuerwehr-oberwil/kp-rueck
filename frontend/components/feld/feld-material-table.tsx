'use client'

/**
 * The Magazin's own view: every unit in the station, and where it is right now.
 *
 * What this replaced was a list of **Schadenplätze** the Materialwart's material
 * happened to hang off — which answers the wrong question. They are looking
 * after the material, not the incidents, and the question actually asked at
 * 02:00 is *wo ist die zweite Tauchpumpe?*. A list of addresses cannot answer
 * it, and a unit sitting safely in the Magazin appeared nowhere at all.
 *
 * So: one row per unit, alphabetical, with where it is. Alphabetical rather
 * than grouped by Schadenplatz because this list is read to **find one thing** —
 * grouping optimises for the pickup round, which is the rarer job and is still
 * legible here since the «Wo» column repeats.
 *
 * Three states, from two different authorities — see `crud/feld/material.py`:
 * the board says what is assigned (`out`), the crew's rapport says what was
 * left behind with no assignment to check against (`left`), and everything else
 * is in the Magazin (`in`).
 */

import { useTranslations } from 'next-intl'
import { Package } from 'lucide-react'

import type { ApiFeldMaterialItem } from '@/lib/api-client'

/** The visual weight of each state, strongest first — `left` is the one that
 *  needs somebody to act, so it is the only one that carries a warning tone. */
const STATE_TONE: Record<ApiFeldMaterialItem['state'], string> = {
  left: 'bg-warning/20 text-warning-foreground',
  out: 'bg-info/15 text-info',
  in: 'bg-success/15 text-success',
}

export function FeldMaterialTable({ materials }: { materials: ApiFeldMaterialItem[] }) {
  const t = useTranslations('feld.material')

  const out = materials.filter(item => item.state !== 'in').length

  if (materials.length === 0) {
    return <p className="px-2 text-sm text-muted-foreground">{t('empty')}</p>
  }

  return (
    <div>
      {/* The one number a Materialwart wants before reading any row: how much
          is still out there. The rest of the count is arithmetic they can do. */}
      <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Package className="h-4 w-4 shrink-0" />
        {t('summary', { out, total: materials.length })}
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="pb-1.5 pr-2 font-semibold">{t('columnMaterial')}</th>
            <th className="pb-1.5 pr-2 font-semibold">{t('columnWhere')}</th>
            <th className="pb-1.5 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {materials.map((item, index) => (
            <tr key={item.material_id ?? `${item.name}-${index}`} className="border-b border-border/60 align-top">
              <td className="py-2 pr-2">
                <span className="font-medium">{item.name}</span>
                {/* Where it BELONGS — the shelf it goes back onto. Different
                    question from "wo ist es jetzt", and both are needed to put
                    a pickup round away again. */}
                {item.home_location && (
                  <span className="block text-xs text-muted-foreground">{item.home_location}</span>
                )}
              </td>
              <td className="py-2 pr-2">{item.at ?? t('inMagazin')}</td>
              <td className="py-2">
                <span
                  className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[item.state]}`}
                >
                  {t(`state.${item.state}`)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

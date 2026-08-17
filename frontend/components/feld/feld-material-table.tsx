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
 * So: one row per unit, with where it is. Alphabetical rather than grouped by
 * Schadenplatz because this list is read to **find one thing** — grouping
 * optimises for the pickup round, which is the rarer job and is still legible
 * here since the «Wo» column repeats.
 *
 * With one exception, which the real roster forced: Oberwil has 38 units and on
 * a normal night three of them are out. Pure alphabetical order buries those
 * three inside thirty-five rows that all read «Magazin», so what is out sorts to
 * the top and the Magazin follows. Alphabetical still holds *within* each half,
 * which is what "find one thing" actually needs.
 *
 * The columns are the three axes a station files its material by — `type` (what
 * a thing is), `home_location` (the depot shelf) and `group` (the module it is
 * packed with) — plus where it is now. There is deliberately **no status
 * column**: «Wo» already says «Magazin» or names a Schadenplatz, so a chip
 * repeating that in one word carried no information of its own.
 *
 * `left` is the one exception and stays, because it is not the same fact: the
 * crew's rapport says the unit stayed behind and there is no assignment to check
 * that against, so the address is somebody's word rather than the board's
 * record. See `crud/feld/material.py`.
 */

import { useTranslations } from 'next-intl'
import { Package } from 'lucide-react'

import type { ApiFeldMaterialItem } from '@/lib/api-client'

export function FeldMaterialTable({ materials }: { materials: ApiFeldMaterialItem[] }) {
  const t = useTranslations('feld.material')

  const out = materials.filter(item => item.state !== 'in').length
  // A column of nothing but em-dashes is a column. Not every station files its
  // material on all three axes — Oberwil uses `type` and the depot shelf and has
  // no modules at all — so a column appears only once something is in it.
  const showType = materials.some(item => item.type)
  const showGroup = materials.some(item => item.group)
  const rows = [...materials].sort((a, b) => {
    const aOut = a.state !== 'in'
    const bOut = b.state !== 'in'
    if (aOut !== bOut) return aOut ? -1 : 1
    return a.name.localeCompare(b.name, 'de')
  })

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

      {/* Its own scroller: four columns do not fit a phone, and the page body
          must never scroll sideways. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[26rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="pb-1.5 pr-3 font-semibold">{t('columnMaterial')}</th>
              {showType && <th className="pb-1.5 pr-3 font-semibold">{t('columnType')}</th>}
              {showGroup && <th className="pb-1.5 pr-3 font-semibold">{t('columnGroup')}</th>}
              <th className="pb-1.5 font-semibold">{t('columnWhere')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={item.material_id ?? `${item.name}-${index}`} className="border-b border-border/60 align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium">{item.name}</span>
                  {/* Where it BELONGS — the shelf it goes back onto. A different
                      question from "wo ist es jetzt", and both are needed to put
                      a pickup round away again. */}
                  {item.home_location && (
                    <span className="block text-xs text-muted-foreground">{item.home_location}</span>
                  )}
                </td>
                {showType && (
                  <td className="py-2 pr-3 text-muted-foreground">{item.type ?? '—'}</td>
                )}
                {showGroup && (
                  <td className="py-2 pr-3 text-muted-foreground">{item.group ?? '—'}</td>
                )}
                {/* `whitespace-nowrap`: the row scrolls sideways as a whole, so
                    an address is better read in one line than broken mid-word. */}
                <td
                  className={`whitespace-nowrap py-2 ${item.state === 'in' ? 'text-muted-foreground' : 'font-medium'}`}
                >
                  {item.at ?? t('inMagazin')}
                  {/* Somebody's word, not the board's record — the one thing the
                      «Wo» column cannot say on its own. */}
                  {item.state === 'left' && (
                    <span className="block text-xs font-normal text-warning-foreground">{t('state.left')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

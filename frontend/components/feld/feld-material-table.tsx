'use client'

/**
 * The Magazin's own view: what is where, in three lists.
 *
 * What this replaced was a list of **Schadenplätze** the Materialwart's material
 * happened to hang off — which answers the wrong question. They are looking
 * after the material, not the incidents, and the question actually asked at
 * 02:00 is *wo ist die zweite Tauchpumpe?*. A list of addresses cannot answer
 * it, and a unit sitting safely in the Magazin appeared nowhere at all.
 *
 * **Three lists, not a «Wo» column.** The first attempt carried the address on
 * every row and needed four columns to do it, which on a phone meant sideways
 * scrolling to read the one thing that mattered. But the Materialwart does not
 * need the street: they need to know whether a unit is in the Magazin, out on a
 * job, or left behind somewhere. That is three buckets, and a heading says it
 * better than a column repeating an address thirty-eight times.
 *
 * The three come from two different authorities — see `crud/feld/material.py`.
 * The board says what is assigned (`out`); the crew's rapport says what stayed
 * behind with no assignment to check against (`left`), which is why it is its
 * own list rather than folded into `out`; everything else is in the Magazin.
 *
 * Alphabetical within each list, because this is read to **find one thing**.
 */

import { useTranslations } from 'next-intl'
import { Package } from 'lucide-react'

import type { ApiFeldMaterialItem } from '@/lib/api-client'

/** The lists, in the order the Magazin asked for them. */
const SECTIONS = ['in', 'out', 'left'] as const

function MaterialList({ items }: { items: ApiFeldMaterialItem[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {items.map((item, index) => (
        <li
          key={item.material_id ?? `${item.name}-${index}`}
          className="flex items-baseline justify-between gap-3 py-2 text-sm"
        >
          <span className="font-medium">{item.name}</span>
          {/* The shelf it belongs on — the only "where" a Materialwart needs,
              because it is where the thing goes back to. */}
          {item.home_location && (
            <span className="shrink-0 text-xs text-muted-foreground">{item.home_location}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function FeldMaterialTable({ materials }: { materials: ApiFeldMaterialItem[] }) {
  const t = useTranslations('feld.material')

  if (materials.length === 0) {
    return <p className="px-2 text-sm text-muted-foreground">{t('empty')}</p>
  }

  const byState = {
    in: [] as ApiFeldMaterialItem[],
    out: [] as ApiFeldMaterialItem[],
    left: [] as ApiFeldMaterialItem[],
  }
  for (const item of materials) byState[item.state].push(item)
  for (const list of Object.values(byState)) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }

  const out = byState.out.length + byState.left.length

  return (
    <div>
      {/* The one number a Materialwart wants before reading any list: how much
          is still out there. The rest of the count is arithmetic they can do. */}
      <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <Package className="h-4 w-4 shrink-0" />
        {t('summary', { out, total: materials.length })}
      </p>

      <div className="space-y-4">
        {SECTIONS.map(state =>
          byState[state].length === 0 ? null : (
            <section key={state}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`state.${state}`)} · {byState[state].length}
              </h3>
              <MaterialList items={byState[state]} />
            </section>
          )
        )}
      </div>
    </div>
  )
}

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
 * The board says what is assigned; the crew's rapport says which of those units
 * stayed behind (`left`), plus the ones it named with no assignment at all.
 * That is why `left` is its own list rather than folded into `out`: "läuft im
 * Keller" and "liegt dort und muss geholt werden" are different jobs.
 *
 * Alphabetical within each list, because this is read to **find one thing**.
 */

import { useTranslations } from 'next-intl'
import { Package } from 'lucide-react'

import type { ApiFeldMaterialItem } from '@/lib/api-client'

/**
 * The lists, most-actionable first.
 *
 * `left` leads and is the only one drawn in colour: a unit the crew says stayed
 * behind is the pickup round, and it is the one thing on this screen that is
 * WORK rather than inventory. `out` follows — in use, nothing to do about it
 * yet. The Magazin comes last because on a normal night it is thirty-five of
 * thirty-eight rows, and putting it first buried the three that needed doing
 * under a screen of things that did not.
 */
const SECTIONS = ['left', 'out', 'in'] as const

function MaterialList({ items }: { items: ApiFeldMaterialItem[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {items.map((item, index) => (
        <li
          key={item.material_id ?? `${item.name}-${index}`}
          className="flex items-baseline justify-between gap-3 py-2 text-sm"
        >
          <span className="font-medium">{item.name}</span>
          {/* Normally the shelf it belongs on — the only "where" a Materialwart
              needs, because it is where the thing goes back to. For a unit that
              stayed behind the useful where is the opposite one: the address
              somebody has to drive to. A pickup list without a street on it is
              a list nobody can act on. */}
          {(item.state === 'left' ? item.at : item.home_location) && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.state === 'left' ? item.at : item.home_location}
            </span>
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
            // «Noch vor Ort» is the only list with something to DO on it, so it
            // is the only one that is coloured: amber heading, amber rule, and
            // a tinted box around the rows. The other two are inventory, and an
            // inventory heading that shouts is one an eye learns to skip —
            // which is what happened to this one while it looked like the
            // others.
            <section
              key={state}
              className={
                state === 'left'
                  ? 'rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2'
                  : undefined
              }
            >
              <h3
                className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${
                  state === 'left' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                }`}
              >
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

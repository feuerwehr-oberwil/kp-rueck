'use client'

import { useTranslations } from 'next-intl'
import { ChevronDown } from 'lucide-react'

import { FeldMaterialTable } from '@/components/feld/feld-material-table'
import { Reveal } from '@/components/ui/reveal'
import type { ApiFeldMaterialItem } from '@/lib/api-client'

/**
 * The Magazin's own view on /feld: a foldable section around the inventory table. The page
 * renders it in one of two places – leading the page for somebody whose whole job it is, after
 * the feed (folded) for somebody also out on a Schadenplatz – and keeps `expanded` itself, so
 * the fold survives the move between them.
 */
export function FeldMaterialSection({
  materials,
  expanded,
  onExpandedChange,
}: {
  materials: ApiFeldMaterialItem[]
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}) {
  const t = useTranslations('feld')
  return (
    <section className="mb-6 rounded-xl bg-secondary/30 p-4">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
      >
        <h2 className="type-label text-muted-foreground">{t('material.title')}</h2>
        {/* Folded, the header carries the one number worth carrying — the table
            says the same thing in its own first line once it is open. */}
        {!expanded && (
          <span className="text-xs text-muted-foreground">
            {t('material.summary', {
              out: materials.filter(item => item.state !== 'in').length,
              total: materials.length,
            })}
          </span>
        )}
        <ChevronDown
          className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      <Reveal open={expanded} innerClassName="pt-3">
        <FeldMaterialTable materials={materials} />
      </Reveal>
    </section>
  )
}

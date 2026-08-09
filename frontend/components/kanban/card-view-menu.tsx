'use client'

/**
 * "Ansicht" — the one footer control that decides what a kanban card shows.
 *
 * It replaces the two pills ("Meldung", "Reko") that used to sit here. Two pills
 * for two of nine blocks was an accident of history: the blocks people actually
 * want gone on a full board are the long ones (Mannschaft, Fahrzeuge, Material),
 * and there was no way to reach them.
 *
 * Presets first, switches underneath. Picking a preset writes every switch;
 * flipping a switch afterwards changes only that switch and drops the preset
 * highlight. Nothing snaps back — a card that re-grows a block you just closed
 * would be worse than no presets at all.
 */

import { useTranslations } from 'next-intl'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  CARD_VIEW_KEYS,
  CARD_VIEW_PRESET_ORDER,
  type CardViewKey,
  type CardViewPreset,
  type CardViewSettings,
} from '@/lib/card-view'
import { cn } from '@/lib/utils'

export function CardViewMenu({
  view,
  preset,
  onApplyPreset,
  onToggleKey,
}: {
  view: CardViewSettings
  preset: CardViewPreset | null
  onApplyPreset: (preset: CardViewPreset) => void
  onToggleKey: (key: CardViewKey) => void
}) {
  const t = useTranslations('kanban.cardView')
  const activeCount = CARD_VIEW_KEYS.filter((key) => view[key]).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="px-2.5 text-muted-foreground transition-colors hover:text-foreground data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
          title={t('tooltip')}
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="text-xs">{t('label')}</span>
          <span className="text-2xs tabular-nums text-muted-foreground/70">
            {preset ? t(`preset.${preset}`) : t('custom', { count: activeCount })}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-60 p-2" data-testid="card-view-menu">
        <div className="px-1 pb-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('presetsHeading')}
        </div>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('presetsHeading')}>
          {CARD_VIEW_PRESET_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={preset === option}
              onClick={() => onApplyPreset(option)}
              className={cn(
                'h-7 rounded-md border text-xs transition-colors',
                preset === option
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(`preset.${option}`)}
            </button>
          ))}
        </div>

        <div className="-mx-2 my-2 h-px bg-border" />

        <div className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('blocksHeading')}
        </div>
        <div className="space-y-0.5">
          {CARD_VIEW_KEYS.map((key) => (
            <label
              key={key}
              className="flex h-7 cursor-pointer items-center justify-between gap-2 rounded-md px-1 text-xs text-foreground/90 hover:bg-muted/60"
            >
              <span>{t(`block.${key}`)}</span>
              <Switch
                checked={view[key]}
                onCheckedChange={() => onToggleKey(key)}
                aria-label={t(`block.${key}`)}
              />
            </label>
          ))}
        </div>

        {/* Says out loud what the menu deliberately does not offer, so nobody
            hunts for a switch that will never be there. */}
        <p className="mt-2 border-t pt-2 px-1 text-2xs leading-snug text-muted-foreground/80">
          {t('alwaysVisibleHint')}
        </p>
      </PopoverContent>
    </Popover>
  )
}

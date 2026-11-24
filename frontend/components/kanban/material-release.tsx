'use client'

/**
 * The «N Geräte freigeben» button under «Zurück» in the rapport's Material block (KP
 * mount, Feld-tab pick 1A, 24.11.2026), with the units it frees named beside it – an
 * unused one included, so the click is not a blind one.
 *
 * Presentational: `useMaterialRelease` owns the set and the release, and the rapport
 * form hands in only the units its current answers do not keep on site. Renders nothing
 * for an empty set.
 */

import { useTranslations } from 'next-intl'
import { Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ShellLoader } from '@/components/ui/shell-loader'
import type { ApiMaterialReturnUnit } from '@/lib/api/types'

interface MaterialReleaseButtonProps {
  units: readonly ApiMaterialReturnUnit[]
  releasing: boolean
  onRelease: () => void
}

export function MaterialReleaseButton({ units, releasing, onRelease }: MaterialReleaseButtonProps) {
  const t = useTranslations('feld.materialReturn')
  if (units.length === 0) return null

  const names = units.map(unit => (unit.used === false ? `${unit.name} (${t('notUsed')})` : unit.name)).join(', ')
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button size="sm" variant="outline" disabled={releasing} onClick={onRelease}>
        {releasing ? <ShellLoader className="size-3.5" /> : <Undo2 className="size-3.5" />}
        {t('releaseAll', { count: units.length })}
      </Button>
      <p className="min-w-0 text-xs text-muted-foreground">{t('stillAssigned', { names })}</p>
    </div>
  )
}

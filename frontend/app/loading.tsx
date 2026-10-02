import { getTranslations } from 'next-intl/server'

import { LoadingStatus } from '@/components/ui/shell-loader'

/**
 * What a cold navigation shows until the route's own content is ready.
 *
 * The shell trail with words, deliberately, and not a skeleton. Route-level means this
 * stands in for the board, the map, settings and everything else — and most of those are
 * not lists of cards, so a placeholder in the shape of one page would be wrong on the
 * next. Keeping a skeleton honest would mean maintaining a second copy of every layout;
 * «Wird geladen …» says content is coming and claims nothing about what shape it will take.
 *
 * It used to be a wordless spinner. A wait without words says neither what is loading nor
 * whether anything is, so every stand-alone loader now carries them (`LoadingStatus`).
 */
export default async function Loading() {
  const t = await getTranslations('common')
  return (
    <div className="flex h-full items-center justify-center p-6" aria-busy="true">
      <LoadingStatus size="surface" className="text-sm">
        {t('loading')}
      </LoadingStatus>
    </div>
  )
}

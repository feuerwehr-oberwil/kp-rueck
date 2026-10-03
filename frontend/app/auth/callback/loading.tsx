import { getTranslations } from 'next-intl/server'

import { BootScreen } from '@/components/boot-screen'

/**
 * The callback's first paint. The page reads its code through `useSearchParams`, so the route
 * waits for the client; without this file the root `loading.tsx` stood in — a shell trail with
 * «Wird geladen …» — before the snail appeared: a second loader in front of the first. The same
 * boot screen instead, so the snail starts its one arrival at the first paint.
 */
export default async function Loading() {
  const t = await getTranslations('login.callback')
  return <BootScreen phase={t('processing')} restartHref="/login" />
}

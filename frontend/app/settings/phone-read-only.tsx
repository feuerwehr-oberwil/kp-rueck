'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

/**
 * Settings on the phone are for looking (owner's pick, 14.11.2026: the phone board is
 * read-only). A section renders as it does on the desk, under one line that says where changes
 * are made, inside a disabled <fieldset> – which disables every field, switch, select and
 * button in it natively (the same trick as `DemoLock`). «Dieses Gerät» is the exception the
 * page makes: it only changes this phone.
 */
export function PhoneReadOnly({ active, children }: { active: boolean; children: ReactNode }) {
  const t = useTranslations('settings.page')
  if (!active) return <>{children}</>
  return (
    <>
      <p role="note" className="text-sm text-muted-foreground">
        {t('phoneReadOnly')}
      </p>
      <fieldset disabled className="m-0 min-w-0 space-y-6 border-0 p-0">
        {children}
      </fieldset>
    </>
  )
}

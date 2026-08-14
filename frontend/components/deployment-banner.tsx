'use client'

import { useTranslations } from 'next-intl'
import { FlaskConical } from 'lucide-react'

import { useDeployment } from '@/lib/hooks/use-deployment'

/**
 * Permanent band naming a non-production deployment: *Staging – Übungssystem*.
 *
 * The cheapest safety measure in the whole staging setup, and the one that catches the most
 * common mistake: the wrong tab at 02:00. It sits above everything, on every route including
 * the login screen and the public phone forms, and it never dismisses — the moment it can be
 * clicked away is the moment somebody clicks it away and forgets.
 *
 * Renders nothing at all on production, which is every other deployment.
 */
export function DeploymentBanner() {
  const t = useTranslations('common.deploymentBanner')
  const deployment = useDeployment()

  if (!deployment.label) return null

  return (
    <div
      data-deployment-band
      role="note"
      aria-label={t('ariaLabel', { label: deployment.label })}
      className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/50 bg-amber-500 px-4 py-1 text-center text-xs font-extrabold tracking-[2px] text-amber-950 uppercase"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{deployment.label}</span>
      <span className="hidden font-semibold normal-case tracking-normal opacity-80 sm:inline">
        {t('hint')}
      </span>
    </div>
  )
}

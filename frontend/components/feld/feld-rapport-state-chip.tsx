'use client'

import { useTranslations } from 'next-intl'
import { CheckCircle2, FileText } from 'lucide-react'

import type { ApiFeldAssignment } from '@/lib/api-client'

/**
 * What this Schadenplatz still wants from you, as one chip.
 *
 * The scale used to run the wrong way. `none` — the only state that means «du
 * schuldest noch etwas» — wore the same grey as every inert chip on the page,
 * while `submitted`, the state with nothing left to do, got the strongest
 * colour. Next to «Nicht mehr zugewiesen», also grey, the two quiet signals
 * added up to "this card is finished" on a card whose line above says in red
 * that the Rapport is your job.
 *
 * So colour answers ONE question — is there work here? — and both open states
 * carry it. The word answers the second: `kein Rapport` has not been started,
 * `Entwurf` has. The fill keeps them apart without spending a second colour on
 * a distinction that is secondary to «offen ja/nein».
 */
export function RapportStateChip({ state }: { state: ApiFeldAssignment['rapport_state'] }) {
  const t = useTranslations('feld.rapportState')
  const styles: Record<ApiFeldAssignment['rapport_state'], string> = {
    none: 'bg-warning/20 text-warning-foreground',
    draft: 'border border-warning/50 text-warning-foreground',
    submitted: 'bg-success/15 text-success',
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${styles[state]}`}>
      {state === 'submitted' ? <CheckCircle2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
      {t(state)}
    </span>
  )
}

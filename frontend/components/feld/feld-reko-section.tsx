'use client'

/**
 * "Reko erfassen" — the Reko form, mounted inside `/feld` (plan 26, step 3).
 *
 * This is what retires `/reko-dashboard`. That page was structurally the same
 * page as `/feld` — picker, my rows, open a form — with its own token, its own
 * cookie and its own copy of the picker; the only thing it really owned was
 * minting the per-incident form token.
 *
 * So that is the only thing that moved. `/feld` runs its own two-step and asks
 * the backend for the **same** form token `/reko-dashboard` used to hand out,
 * then hands it to the board's own `RekoForm`. Deliberately not done by
 * teaching `validate_form_token` about feld tokens: coupling two doors for the
 * sake of one screen is how a token type stops meaning anything.
 *
 * Only somebody the KP gave a Reko auftrag gets here — the server refuses the
 * mint otherwise (`sources=(SOURCE_REKO,)`). A crew working the Schadenplatz
 * reads the Reko above as briefing and files a Schadenplatz-Rapport instead.
 */

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'

interface FeldRekoSectionProps {
  incidentId: string
  personnelId: string
  token: string
}

export function FeldRekoSection({ incidentId, personnelId, token }: FeldRekoSectionProps) {
  const t = useTranslations('feld.reko')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  /**
   * The token is minted on the tap, not on render.
   *
   * It is short-lived (24 h) and one is enough per filing, so minting it while
   * the page merely *shows* a row would spend one every ten seconds on the
   * poll — and would put a live credential in the DOM of every Reko row the
   * crew never opens.
   */
  const openForm = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const { link } = await apiClient.mintFeldRekoLink(incidentId, personnelId, token)
      router.push(link)
    } catch (error) {
      console.error('Failed to mint reko link:', error)
      setFailed(true)
      setLoading(false)
    }
  }, [incidentId, personnelId, token, router])

  return (
    <section className="rounded-xl bg-secondary/30 p-4">
      <h2 className="mb-1 text-sm font-medium">{t('title')}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t('description')}</p>
      <Button size="lg" className="w-full" onClick={openForm} disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        {t('open')}
      </Button>
      {failed && <p className="mt-2 text-sm text-destructive">{t('failed')}</p>}
    </section>
  )
}

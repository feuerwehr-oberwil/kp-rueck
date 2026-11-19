'use client'

import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle2 } from 'lucide-react'

/**
 * After «Reko-Bericht übermitteln» from a link of an alarm or a QR code. Says WHICH Einsatz
 * went to the KP — the address (`ort`, set by the form), never the incident's UUID, which
 * nobody can read over the radio. No «Zurück»: such a link has nowhere to go back to, and `/`
 * would send an unauthenticated phone to the login screen. A form opened from /feld never
 * lands here – it goes straight back to the list with a toast (reko-form.tsx, `return_to`).
 */
export default function RekoSuccessPage() {
  const searchParams = useSearchParams()
  const t = useTranslations('reko.success')
  const address = searchParams.get('ort')?.trim()

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
            <CheckCircle2 className="h-10 w-10 text-success" />
          </div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription className="break-words">
            {address ? t('descriptionAt', { address }) : t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-sm text-muted-foreground">{t('closeHint')}</p>
        </CardContent>
      </Card>
    </div>
  )
}

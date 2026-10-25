'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, ArrowLeft } from 'lucide-react'

/**
 * After «Reko-Bericht übermitteln». Says WHICH Einsatz went to the KP — the
 * address (`ort`, set by the form), never the incident's UUID, which nobody can
 * read over the radio. «Zurück» only when the form was opened with a `return_to`
 * path: a Reko link from an alarm or a QR code has nowhere to go back to, and
 * `/` would send an unauthenticated phone to the login screen.
 */
export default function RekoSuccessPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const t = useTranslations('reko.success')
  const address = searchParams.get('ort')?.trim()
  // Our own paths only — never a link to somewhere else.
  const rawReturnTo = searchParams.get('return_to')
  const returnTo = rawReturnTo?.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : null

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-info/10">
            <CheckCircle2 className="h-10 w-10 text-info" />
          </div>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription className="break-words">
            {address ? t('descriptionAt', { address }) : t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">{t('closeHint')}</p>
          {returnTo && (
            <Button onClick={() => router.push(returnTo)} variant="outline" className="w-full">
              <ArrowLeft className="size-4" />
              {t('back')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

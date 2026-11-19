'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { reportClientError } from '@/lib/report-error'

/** The Lagekarte's route error boundary: says what broke, reports it, offers a retry. */
export default function MapError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors.mapError')
  useEffect(() => {
    console.error('Map error:', error)
    reportClientError(error, { kind: 'render' })
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <MapPin className="h-12 w-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            {t('title')}
          </h1>
          <p className="text-muted-foreground">
            {t('description')}
          </p>
        </div>

        {/* The reason, in production too: a screenshot of this screen is what reaches us,
            and without the message the next one is not diagnosable. */}
        {(error.message || error.digest) && (
          <p className="font-mono text-xs text-muted-foreground break-words">
            {error.message}
            {error.digest ? ` · ${error.digest}` : ''}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={reset}>
            <RefreshCw className="size-4" />
            {t('retry')}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">
              <Home className="size-4" />
              {t('home')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

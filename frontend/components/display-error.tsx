'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  HEALTHY_UPTIME_MS,
  clearRetryAttempts,
  readRetryAttempts,
  retryDelayFor,
  writeRetryAttempts,
} from '@/lib/utils/display-retry'

/**
 * Error boundary for the unattended wall displays (`/display/*`).
 *
 * These screens run for hours with nobody at the keyboard, so the shared
 * RouteError — whose only recovery is a button press — leaves a dead display
 * until someone physically walks over to it. This variant recovers itself.
 *
 * It reloads the document instead of calling `reset()`. `reset()` re-renders
 * the same tree from the same client state, so a deterministic fault (a bad
 * payload, a poisoned cached value) throws again immediately. A document
 * reload rebuilds everything and is the only thing that clears bad state.
 *
 * Backoff and attempt bookkeeping live in lib/utils/display-retry, shared with
 * app/global-error.tsx — that boundary covers throws in the root LAYOUT, which
 * no per-route error.tsx can catch, and a display can hit it just as easily.
 */

export default function DisplayError({ error }: { error: Error & { digest?: string } }) {
  const t = useTranslations('errors.displayError')
  // Read once, at mount: the value is bumped immediately below, and the
  // countdown must not shift under the operator as it ticks.
  const attemptRef = useRef<number>(null!)
  attemptRef.current ??= readRetryAttempts()

  const delayMs = retryDelayFor(attemptRef.current)
  const [secondsLeft, setSecondsLeft] = useState(() => Math.round(delayMs / 1000))

  useEffect(() => {
    console.error('Display error:', error)
  }, [error])

  useEffect(() => {
    writeRetryAttempts(attemptRef.current + 1)

    const tick = setInterval(() => {
      setSecondsLeft(prev => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    const reload = setTimeout(() => window.location.reload(), delayMs)

    return () => {
      clearInterval(tick)
      clearTimeout(reload)
    }
  }, [delayMs])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="h-12 w-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground">
            {secondsLeft > 0 ? t('retryingIn', { seconds: secondsLeft }) : t('retrying')}
          </p>
        </div>

        {process.env.NODE_ENV === 'development' && (
          <div className="rounded-lg bg-muted p-4 text-left">
            <p className="break-all font-mono text-sm text-muted-foreground">{error.message}</p>
          </div>
        )}

        <Button onClick={() => window.location.reload()}>
          <RefreshCw className="size-4" />
          {t('retryNow')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Resets the retry backoff once a display has rendered healthily for a while.
 * Mounted by the display layout so every `/display/*` page gets it.
 */
export function useDisplayErrorRecovery(): void {
  useEffect(() => {
    const timer = setTimeout(clearRetryAttempts, HEALTHY_UPTIME_MS)
    return () => clearTimeout(timer)
  }, [])
}

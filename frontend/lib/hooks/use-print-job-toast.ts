'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { trackPrintJob, type PrintJobToastCopy, type TrackPrintJobOptions } from '@/lib/print-job-tracker'

/**
 * Bind the print-job tracker to i18n and the router.
 *
 * Every place that queues a print calls this instead of `toast.success(...)`: the
 * "gesendet" message is the same, but it now stays on screen until the agent says
 * the slip printed — or says why it did not.
 */
export function usePrintJobToast() {
  const t = useTranslations('print.toasts')
  const router = useRouter()

  return useCallback(
    (jobId: string, options: Omit<TrackPrintJobOptions, 'onOpenPrinterSettings'>) => {
      const copy: PrintJobToastCopy = {
        completed: t('completed'),
        failed: t('failed'),
        failedRetry: t('failedRetry'),
        unknownError: t('unknownError'),
        notPickedUp: t('notPickedUp'),
        notPickedUpHint: t('notPickedUpHint'),
        offline: t('offline'),
        offlineHint: t('offlineHint'),
        noResult: t('noResult'),
        noResultHint: t('noResultHint'),
        checkPrinter: t('checkPrinter'),
      }
      trackPrintJob(jobId, copy, {
        ...options,
        onOpenPrinterSettings: () => router.push('/settings?section=printer'),
      })
    },
    [t, router]
  )
}

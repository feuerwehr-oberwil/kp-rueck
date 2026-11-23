'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Binoculars } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/components/ui/use-mobile'
import { LoadingStatus, ShellLoader } from '@/components/ui/shell-loader'
import { SyncStatusLine } from '@/components/kanban/field-save-status'
import { RekoReportForm, EMPTY_REKO_FORM, hasRekoContent, type RekoFormData } from '@/components/reko/reko-report-form'
import { useRekoAutosave } from '@/components/reko/use-reko-autosave'
import { apiClient } from '@/lib/api-client'
import { useAuth } from '@/lib/contexts/auth-context'
import type { Operation } from '@/lib/contexts/operations-context'

/**
 * «Reko-Bericht · {Einsatz}» – the gate of a card moved into «Reko abgeschlossen» without a
 * report (owner pick 19.11.2026, #4 A). The board's Reko form opens at once, in the same mount
 * as the incident detail (`RekoReportForm mount="kp"`, every field saved as it is given by
 * `useRekoAutosave` – the operator's KP draft).
 *
 * One rule files the report (owner re-pick 19.11.2026, #30): the save that answers «Einsatz
 * relevant?» – like the crew's submit, wherever the card is; the server then moves a card in
 * «Reko» to «Reko abgeschlossen». A status move files nothing.
 *
 * The card has NOT moved yet (`holdStatusMove`). «Reko abschliessen» is live once «Einsatz
 * relevant?» is answered: it sends a waiting save, waits until the saves have settled, then
 * `onFinish` moves the card – harmless after the filing's own move, and the only move for a
 * card the filing does not move (from «Eingegangen»). While the answer is open it says why it
 * waits, and «Ohne Bericht abschliessen» moves the card without filing – a draft with content
 * stays a draft. Abbrechen, Esc and ✕ are `onCancel`: the card stays where it is (a waiting
 * save still goes out on close).
 *
 * The form starts from the newest filed report (amended in place) or the operator's own draft,
 * as the detail's Reko block does. A dialog on a desk, a bottom sheet on a phone.
 */
const WAIT_HINT_ID = 'reko-gate-wait-hint'

export function RekoReportGateDialog({
  operation,
  location,
  onCancel,
  onFinish,
}: {
  operation: Operation
  /** The Einsatz as the board names it – the title says which one. */
  location: string
  onCancel: () => void
  onFinish: () => void
}) {
  const t = useTranslations('kanban.rekoGate')
  const tCommon = useTranslations('kanban.common')
  const tLoading = useTranslations('common')
  const isMobile = useIsMobile()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const incidentId = operation.id
  /** The form as it was opened, or as a save answered it – not an edit, so not saved. */
  const opened = useRef<RekoFormData | null>(null)
  const [form, setForm] = useState<RekoFormData>(EMPTY_REKO_FORM)
  /** A save answered: show the report as the server has it, edits made meanwhile on top. */
  const adoptForm = useCallback((next: RekoFormData) => {
    opened.current = next
    setForm(next)
  }, [])
  const autosave = useRekoAutosave({ incidentId, userId, onAdopt: adoptForm })
  const resumeAutosave = autosave.resume
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  /** «Reko abschliessen» was pressed: the move waits for the saves to settle. */
  const [finishing, setFinishing] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // The Einsatz's one report, draft or filed (or none yet).
        const [source] = await apiClient.getIncidentRekoReports(incidentId)
        if (cancelled) return
        const start = resumeAutosave(source ?? null)
        opened.current = start
        setForm(start)
        setPhase('ready')
      } catch (error) {
        console.error('Failed to load the Reko report:', error)
        if (!cancelled) setPhase('failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [incidentId, userId, resumeAutosave, attempt])

  // Every change saves (debounced); the value the form was opened with is not an edit.
  const scheduleSave = autosave.schedule
  useEffect(() => {
    if (phase !== 'ready' || form === opened.current) return
    scheduleSave(form)
  }, [form, phase, scheduleSave])

  const photos = useMemo(
    () => ({
      upload: async (file: File) => (await apiClient.uploadRekoPhotoAsEditor(incidentId, file)).filename,
      remove: (filename: string) => apiClient.deleteRekoPhotoAsEditor(incidentId, filename),
    }),
    [incidentId],
  )

  /** The main answer: the newest form on the server first (`flush` sends a waiting save),
   *  then the move – below, once the sync line says the saves settled. */
  const finish = () => {
    autosave.flush()
    setFinishing(true)
  }
  const syncStatus = autosave.state.status
  useEffect(() => {
    if (!finishing) return
    if (syncStatus === 'saved' || syncStatus === 'idle') onFinish()
    // A failed save keeps the dialog open – «Nicht synchronisiert» in the header says why,
    // and the next press tries again.
    else if (syncStatus === 'failed') setFinishing(false)
  }, [finishing, syncStatus, onFinish])

  const answered = form.is_relevant !== null

  const rekoName = operation.assignedReko?.name
  const title = (
    <span className="flex items-center gap-2">
      <Binoculars className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
      <span className="min-w-0">{t('reportTitle', { location })}</span>
    </span>
  )
  const description = rekoName
    ? t.rich('reportLine', { name: rekoName, hl: (chunks) => <span className="font-medium text-foreground">{chunks}</span> })
    : t('reportLineNoPerson')
  // In the fixed header, not at the foot of the scrolling form: always in view. Its row is
  // reserved so the form does not jump when «Synchronisiert – hh:mm» goes quiet.
  const syncLine = phase === 'ready' && (
    <div className="min-h-5">
      <SyncStatusLine state={autosave.state} onRetry={() => void autosave.retry()} />
    </div>
  )

  const body: ReactNode =
    phase === 'loading' ? (
      <div className="flex min-h-40 items-center justify-center">
        <LoadingStatus size="surface" className="text-sm">{tLoading('loading')}</LoadingStatus>
      </div>
    ) : phase === 'failed' ? (
      <div className="flex flex-col items-center gap-3 py-8 text-sm">
        <p className="text-muted-foreground">{t('loadError')}</p>
        <Button variant="outline" size="sm" onClick={() => { setPhase('loading'); setAttempt((n) => n + 1) }}>
          {t('retry')}
        </Button>
      </div>
    ) : (
      <>
        <RekoReportForm
          incidentId={incidentId}
          value={form}
          onChange={setForm}
          photos={photos}
          mount="kp"
        />
        {/* Why the main answer waits, and what the quiet one does with what is entered. */}
        {!answered && (
          <p id={WAIT_HINT_ID} role="status" className="mt-3 text-xs text-muted-foreground">
            {t('finishWaits')}
            {hasRekoContent(form) && <> {t('draftStays')}</>}
          </p>
        )}
      </>
    )

  // «Ohne Bericht» while «Einsatz relevant?» is open: the move files nothing.
  const footer = (
    <>
      {phase !== 'loading' && !answered && (
        <Button variant="ghost" size="sm" className="text-muted-foreground max-sm:basis-full sm:mr-auto" onClick={onFinish}>
          {t('finishWithout')}
        </Button>
      )}
      <Button variant="outline" onClick={onCancel}>{tCommon('cancel')}</Button>
      <Button
        onClick={finish}
        disabled={finishing || phase !== 'ready' || !answered}
        aria-describedby={!answered && phase === 'ready' ? WAIT_HINT_ID : undefined}
      >
        {finishing && <ShellLoader className="size-4" />}
        {t('finish')}
      </Button>
    </>
  )

  const onOpenChange = (open: boolean) => {
    if (!open) onCancel()
  }

  if (isMobile) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[88dvh] modal-h-tall gap-0 rounded-t-2xl [--close-centre:31px]">
          <SheetHeader className="gap-1 px-4 pt-5 pb-3 pr-12 text-left">
            <SheetTitle className="text-lg leading-[1.375rem] font-semibold">{title}</SheetTitle>
            <SheetDescription className="text-xs">{description}</SheetDescription>
            {syncLine}
          </SheetHeader>
          <SheetBody className="px-4 pb-4">{body}</SheetBody>
          <SheetFooter className="mt-0 flex-row flex-wrap gap-2 border-t px-4 pt-3 pb-sheet-safe [&>*]:min-h-11 [&>*]:flex-1">
            {footer}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="md" className="flex modal-h-tall flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="gap-1 px-6 pt-6 pb-3 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {syncLine}
        </DialogHeader>
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-4">{body}</div>
        <DialogFooter className="border-t px-6 py-3">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

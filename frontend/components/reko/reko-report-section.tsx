'use client'

/**
 * The Reko block of the incident detail – THE Reko report of the Einsatz (one per incident,
 * owner pick 23.11.2026, #6: «treat Reko more as the current state of how we see things»).
 *
 * **Board (`canEdit`)**: the form, always open and always editable – no «Ergänzen» step, no
 * read view to swap. The field and the KP edit the same report; every answer is saved as it
 * is given (`useRekoAutosave`, «Synchronisiert – hh:mm» in the head row), and a newer read
 * (the field typed, another board saved – `reko_update`) comes into the open form unless this
 * operator has something unsent. Who changed what and when is in the detail's Chronik only
 * (`reko_change` rows) – the owner wanted no history here. A new report is a draft until
 * «Einsatz relevant?» is answered: the server files it then like the crew's submit (bell,
 * the card to «Reko abgeschlossen»), once.
 *
 * **Phone sheet and wall display (`canEdit` false)**: the filed report as a card, read only.
 * `dense` gives the board's `DetailField` rows (104px gutter, values at 13px) – the Übersicht's
 * vocabulary one tab over; the card keeps thumb targets and its 16px finding.
 *
 * Deliberately not a dialog: a modal over the detail would hide the Feldmeldungen the
 * operator is dictating from. The «vor Ort seit …» line is not here (decision 15): the
 * arrival lives in the Feldmeldungen row (`dataSlot`).
 *
 * Photos open in the incident's viewer (`components/photos/photo-viewer.tsx`), never in a tab.
 */

import { formatTime } from '@/lib/format-time'
import { formatDurationHours } from "@/lib/duration"
import { useState, useEffect, useCallback, useMemo, useRef, Fragment, type ReactNode } from 'react'
import { useEffectEvent } from '@/lib/hooks/use-effect-event'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { DetailField } from '@/components/kanban/detail-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, CircleHelp, Binoculars, FileText, CheckCheck } from 'lucide-react'
import { apiClient, type ApiRekoReportResponse } from '@/lib/api-client'
import { RekoReportForm, EMPTY_REKO_FORM, type RekoFormData } from '@/components/reko/reko-report-form'
import { useRekoAutosave } from '@/components/reko/use-reko-autosave'
import { SyncStatusLine } from '@/components/kanban/field-save-status'
import { usePhotoViewer, useRegisterPhotos } from '@/lib/hooks/use-photo-viewer'
import { rekoPhotoUrl } from '@/lib/reko-photos'
import { useAuth } from '@/lib/contexts/auth-context'
import { cn } from '@/lib/utils'
import { wsClient } from '@/lib/websocket-client'
import { usePolling } from '@/lib/hooks/use-polling'
import { getIntlLocale } from '@/lib/date-locale'
import { LoadingStatus } from '@/components/ui/shell-loader'

interface RekoReportSectionProps {
  incidentId: string
  /** Editor-only: archive the incident (status → complete). When provided and the
      report says "nicht relevant", an "Einsatz abschliessen" button is shown. */
  onRequestComplete?: () => void
  /** Whether this mount may write: the board's form. False on the phone and the wall. */
  canEdit?: boolean
  /**
   * Rendered at the top – the Funkmeldung «Reko vor Ort». It belongs beside the report it
   * is about.
   */
  dataSlot?: ReactNode
  /**
   * The board's mount – the incident detail, modal and 420px panel alike: the read view as
   * `DetailField` rows, the form in its dense shape. Left FALSE on purpose for the phone
   * sheet and the wall display (touch and distance surfaces with their own type scale).
   */
  dense?: boolean
  /** Told `true` once the first read answered and the reports are drawn, `false` on unmount.
   *  The phone sheet waits for it before it scrolls to this block (TAB.8). Pass a stable
   *  function (a state setter, a `useCallback`): a new one each render reports again. */
  onLoadedChange?: (loaded: boolean) => void
}

const POLL_INTERVAL_MS = 5000 // Fallback poll while the socket is down

export default function RekoReportSection({
  incidentId,
  onRequestComplete,
  canEdit = false,
  dataSlot,
  dense = false,
  onLoadedChange,
}: RekoReportSectionProps) {
  const t = useTranslations('reko.reportSection')
  const tLoading = useTranslations('common')
  /** The newest read – a fresh object per read, so the form takes each one in (below). */
  const [read, setRead] = useState<{ report: ApiRekoReportResponse | null } | null>(null)
  const report = read?.report ?? null
  const [isLoading, setIsLoading] = useState(true)
  const [formData, setFormData] = useState<RekoFormData>(EMPTY_REKO_FORM)
  const { user } = useAuth()
  const userId = user?.id ?? null

  /** The form as the server has it (opened, refreshed, or a save's answer) – not an edit,
   *  so not saved. */
  const openedForm = useRef<RekoFormData | null>(null)
  const adoptForm = useCallback((form: RekoFormData) => {
    openedForm.current = form
    setFormData(form)
  }, [])

  // Reloads overlap (a save settling, `reko_update`, the poll): only the newest read's answer
  // is applied – an older one answering last would bring back a stale report (Sol pass 5, S6).
  const readRef = useRef(0)
  const loadReport = useCallback(async () => {
    const read = ++readRef.current
    try {
      const data = await apiClient.getIncidentRekoReports(incidentId)
      if (read !== readRef.current) return
      setRead({ report: data[0] ?? null })
    } catch (error) {
      console.error('Failed to load Reko report:', error)
    } finally {
      setIsLoading(false)
    }
  }, [incidentId])

  // WebSocket for instant updates – every save of the report sends one, drafts too – and a
  // poll only while the socket is down (`usePolling` also runs once the moment it is back).
  useEffect(() => {
    return wsClient.on('reko_update', (update) => {
      if (update.data.incident_id === incidentId) void loadReport()
    })
  }, [loadReport, incidentId])
  usePolling(loadReport, { intervalMs: POLL_INTERVAL_MS, skipWhileWsConnected: true })

  const autosave = useRekoAutosave({ incidentId, userId, onSettled: loadReport, onAdopt: adoptForm })

  // The first read opens the form (a save of this operator still pending wins), every later
  // one refreshes it – the field's and the other boards' answers, live.
  const formOpened = useRef(false)
  const takeServerReport = useEffectEvent((next: ApiRekoReportResponse | null) => {
    if (!canEdit) return
    const form = formOpened.current ? autosave.refresh(next) : autosave.resume(next)
    formOpened.current = true
    if (form) adoptForm(form)
  })
  useEffect(() => {
    if (read) takeServerReport(read.report)
  }, [read])

  // Every change saves (debounced); the value the server gave is not an edit, and nothing
  // saves before the first read opened the form.
  const scheduleSave = autosave.schedule
  useEffect(() => {
    if (!canEdit || openedForm.current === null || formData === openedForm.current) return
    scheduleSave(formData)
  }, [formData, canEdit, scheduleSave])

  /**
   * The board's photo door (§6.1): the crew has no signal and sends the picture over
   * WhatsApp, so the operator attaches it to the report. The session is the credential; the
   * server puts it on the Einsatz's one report.
   */
  const photoTransport = useMemo(
    () => ({
      upload: async (file: File) => (await apiClient.uploadRekoPhotoAsEditor(incidentId, file)).filename,
      remove: (filename: string) => apiClient.deleteRekoPhotoAsEditor(incidentId, filename),
    }),
    [incidentId],
  )

  // The incident's viewer gets the photos this block shows: the form's on the board, the
  // filed report's elsewhere.
  const filed = report && !report.is_draft ? report : null
  const shownPhotos = canEdit ? formData.photos_json : (filed?.photos_json ?? [])
  useRegisterPhotos('reko', shownPhotos.map(filename => ({
    group: 'reko' as const,
    filename,
    src: rekoPhotoUrl(incidentId, filename),
    by: report?.submitted_by_personnel_name ?? null,
    at: filed?.submitted_at ?? null,
  })))

  // The drawn reports' root attaching IS «loaded» – a ref, not an effect on `isLoading`.
  const loadedRootRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !onLoadedChange) return
    onLoadedChange(true)
    return () => onLoadedChange(false)
  }, [onLoadedChange])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <LoadingStatus className="text-sm">{tLoading('loading')}</LoadingStatus>
      </div>
    )
  }

  if (!canEdit) {
    return (
      <div ref={loadedRootRef} className={cn(!dense && 'space-y-2')}>
        {dataSlot && <div className={cn(dense && 'mb-2')}>{dataSlot}</div>}
        {filed ? (
          <RekoReportCard report={filed} incidentId={incidentId} onRequestComplete={onRequestComplete} dense={dense} />
        ) : dense ? (
          <DetailField label={t('reportLabel')}>
            <span className="text-sm italic text-muted-foreground/60">{t('noReportShort')}</span>
          </DetailField>
        ) : (
          <div className="rounded-lg border border-dashed p-3 flex items-center justify-center gap-2 text-muted-foreground">
            <FileText className="h-4 w-4 shrink-0" />
            <p className="text-sm">{t('noReport')}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={loadedRootRef} className={cn(dense ? 'space-y-1' : 'space-y-3')}>
      {dataSlot && <div className="mb-2">{dataSlot}</div>}
      {/* Head row: who reported it and when, the one sync line, and the close shortcut
          a «nicht relevant» report offers. */}
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', dense && 'pb-1.5')}>
        <ReportByline report={report} />
        <div className="ml-auto flex min-w-0 items-center">
          <SyncStatusLine state={autosave.state} onRetry={() => void autosave.retry()} />
        </div>
        {formData.is_relevant === false && onRequestComplete && (
          <Button size="xs" variant="secondary" onClick={onRequestComplete}>
            <CheckCheck className="size-3.5" />
            {t('completeIncident')}
          </Button>
        )}
      </div>
      {/* Until it is filed, say when it will be – and that a KP entry reads as one. */}
      {(!report || report.is_draft) && (
        <p className="text-xs text-muted-foreground">
          {t('radioHint')} {t('draftHint')}
        </p>
      )}
      <RekoReportForm
        incidentId={incidentId}
        value={formData}
        onChange={setFormData}
        photos={photoTransport}
        mount="kp"
      />
    </div>
  )
}

/** «Keller Marco · Übermittelt 19:05 · aktualisiert 19:24», or that nothing is filed yet. */
function ReportByline({ report }: { report: ApiRekoReportResponse | null }) {
  const t = useTranslations('reko.reportSection')
  if (!report || report.is_draft) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Binoculars className="size-3.5 shrink-0" />
        {report ? t('draftShort') : t('noReportShort')}
      </span>
    )
  }
  const submittedStamp = formatStamp(report.submitted_at)
  const updatedStamp = formatStamp(report.updated_at)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
      <Binoculars className="size-3.5 shrink-0" />
      {report.submitted_by_personnel_name && (
        <>
          <span className="font-semibold">{report.submitted_by_personnel_name}</span>
          <span aria-hidden="true">·</span>
        </>
      )}
      {t('submittedShort', { time: submittedStamp })}
      {updatedStamp !== submittedStamp && ` · ${t('updatedShort', { time: updatedStamp })}`}
    </span>
  )
}

/**
 * «Einsatz relevant?» as a filed report answers it: Ja, Nein – or not at all, which old
 * reports and crew data can be (a board report is filed only by the answer). An open answer
 * is never read as «Nein»: no «Kein Einsatz nötig», no «Einsatz abschliessen» for it.
 */
function verdictKey(value: boolean | null, size: 'long' | 'short') {
  if (value === true) return size === 'long' ? 'relevant' : 'relevantShort'
  if (value === false) return size === 'long' ? 'notNeeded' : 'notRelevantShort'
  return size === 'long' ? 'relevanceOpen' : 'relevanceOpenShort'
}

function VerdictIcon({ value, className }: { value: boolean | null; className: string }) {
  if (value === true) return <CheckCircle2 className={cn(className, 'text-success')} />
  if (value === false) return <XCircle className={cn(className, 'text-muted-foreground')} />
  return <CircleHelp className={cn(className, 'text-muted-foreground')} />
}

interface RekoReportCardProps {
  report: ApiRekoReportResponse
  incidentId: string
  onRequestComplete?: () => void
  /** See `RekoReportSectionProps.dense` — rows instead of a card. */
  dense?: boolean
}

/**
 * A report timestamp, to the minute — and only the clock while it is today's.
 * The provenance sits inline next to the verdict now, and «18.08.2026, 19:34»
 * says nothing that «19:34» does not during the incident it belongs to. The
 * date comes back the moment it stops being today, which is when it starts
 * carrying information (a report being reread days later).
 */
function formatStamp(iso: string): string {
  const date = new Date(iso)
  const time = formatTime(date)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isToday) return time
  return `${date.toLocaleDateString(getIntlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })} ${time}`
}

/** A filed report's photo: opens in the incident's viewer, where one is mounted. */
function ReportPhoto({ incidentId, filename, alt, sizes, className }: {
  incidentId: string
  filename: string
  alt: string
  sizes: string
  className: string
}) {
  const open = usePhotoViewer()
  // unoptimized: photos come from the backend at a runtime-determined origin, which Next's
  // optimizer cannot resolve (hosts are configured at build time).
  const image = <Image src={rekoPhotoUrl(incidentId, filename)} alt={alt} fill sizes={sizes} unoptimized className="object-cover" />
  if (!open) return <span className={className}>{image}</span>
  return (
    <button
      type="button"
      onClick={() => open('reko', filename)}
      title={filename}
      className={cn(className, 'cursor-zoom-in transition-opacity hover:opacity-80')}
    >
      {image}
    </button>
  )
}

/**
 * The numbered facts of a report, as `{ label, value }` pairs rather than
 * pre-composed «Label: Wert» strings.
 *
 * Both renderings consume the same list: the card lays it out as a two-column
 * definition grid, the board as `DetailField` rows. In a wrapping row every
 * value started at whatever x the previous string happened to end at, and no
 * two lines agreed on anything — a label column and a value column let the eye
 * run straight down the values.
 *
 * «Zusätzliche Notizen» is the last pair and not a separately styled paragraph
 * — it is a label and a value like the rest, and one emphasis rule for all of
 * them beats a bold label here and a plain one there.
 */
function useReportFacts(
  report: ApiRekoReportResponse,
  dense: boolean,
): { label: string; value: ReactNode; prose?: boolean }[] {
  const t = useTranslations('reko.reportSection')
  const dangers = report.dangers_json
  const dangerLabels: string[] = []
  if (dangers?.fire) dangerLabels.push(t('dangerBadges.fire'))
  if (dangers?.fire_danger) dangerLabels.push(t('dangerBadges.fire_danger'))
  if (dangers?.explosion) dangerLabels.push(t('dangerBadges.explosion'))
  if (dangers?.collapse) dangerLabels.push(t('dangerBadges.collapse'))
  if (dangers?.chemical) dangerLabels.push(t('dangerBadges.chemical'))
  if (dangers?.electrical) dangerLabels.push(t('dangerBadges.electrical'))
  const hasDangers = dangerLabels.length > 0 || !!dangers?.other_notes

  const facts: { label: string; value: ReactNode; prose?: boolean }[] = []
  // Gefahren lead the grid as a labelled row like Mannschaft and Dauer — the
  // hazard itself stays highlighted (warning chips), the row around it does
  // not shout. It used to be a block of its own above the grid, which made one
  // fact of the report richer chrome than all the others.
  if (hasDangers) {
    facts.push({
      label: t('dangers'),
      value: (
        <span className="flex flex-wrap items-center gap-1">
          {dangerLabels.map(label => (
            <Badge
              key={label}
              variant="outline"
              className="border-warning/40 bg-warning/10 text-warning-foreground"
            >
              {label}
            </Badge>
          ))}
          {dangers?.other_notes && <span className="leading-tight">{dangers.other_notes}</span>}
        </span>
      ),
      prose: Boolean(dangers?.other_notes),
    })
  }
  if (report.effort_json?.personnel_count) {
    facts.push({
      label: t('personnelLabel'),
      value: t('personnelValue', { count: report.effort_json.personnel_count }),
    })
  }
  if (report.effort_json?.estimated_duration_hours) {
    facts.push({
      label: t('durationLabel'),
      value: formatDurationHours(report.effort_json.estimated_duration_hours),
    })
  }
  if (report.effort_json?.vehicles_needed?.length) {
    facts.push({ label: t('vehiclesLabel'), value: report.effort_json.vehicles_needed.join(', ') })
  }
  if (report.effort_json?.equipment_needed?.length) {
    facts.push({ label: t('equipmentLabel'), value: report.effort_json.equipment_needed.join(', ') })
  }
  if (report.power_supply && report.power_supply !== 'unknown') {
    facts.push({
      label: t('powerSupply'),
      value:
        report.power_supply === 'available' ? t('powerAvailable')
        : report.power_supply === 'unavailable' ? t('powerUnavailable')
        : t('powerEmergencyNeeded'),
    })
  }
  if (report.additional_notes) {
    // «Zusätzliche Notizen» wraps the 104px label gutter onto two lines and
    // turns a 30px row into a 46px one; on the board the label is «Notizen».
    facts.push({
      label: dense ? t('notesShort') : t('additionalNotes'),
      value: report.additional_notes,
      prose: true,
    })
  }

  return facts
}

/**
 * Everything a report says apart from its verdict, in the mount's own shape:
 * `DetailField` rows on the board, a definition grid in the card.
 *
 * One function for both, because the two must never drift on WHICH facts a
 * report shows — only on how they are laid out.
 */
function RekoReportBody({ report, incidentId, dense = false }: RekoReportCardProps) {
  const t = useTranslations('reko.reportSection')
  const facts = useReportFacts(report, dense)
  const photos = report.photos_json ?? []

  if (dense) {
    return (
      <>
        {/* The finding is a row like the rest. It loses the size it had as a
            standalone paragraph — the cost of Variante A, paid so that every
            value on this tab starts at the same x. */}
        {report.summary_text && (
          <DetailField label={t('findingLabel')} alignStart>
            <p className="text-sm leading-snug">{report.summary_text}</p>
          </DetailField>
        )}
        {facts.map(({ label, value, prose }) => (
          <DetailField key={label} label={label} alignStart={prose}>
            <div className="text-sm leading-snug">{value}</div>
          </DetailField>
        ))}
        {photos.length > 0 && (
          // 96px, not the 40px marks this used to be: at 40 a storm photo was
          // an unreadable smudge. Big enough to recognise the subject, small enough
          // that a row of them still wraps inside the column. A click opens the viewer.
          <DetailField label={t('photosCount', { count: photos.length })}>
            <div className="flex flex-wrap items-center gap-1.5">
              {photos.map((filename, index) => (
                <ReportPhoto
                  key={filename}
                  incidentId={incidentId}
                  filename={filename}
                  alt={report.submitted_by_personnel_name
                    ? t('photoAltBy', { number: index + 1, name: report.submitted_by_personnel_name })
                    : t('photoAlt', { number: index + 1 })}
                  sizes="96px"
                  className="relative block size-24 shrink-0 overflow-hidden rounded-md bg-muted"
                />
              ))}
            </div>
          </DetailField>
        )}
      </>
    )
  }

  return (
    <div className="space-y-3">
      {/* The finding leads, one size above the facts around it — it is the
          sentence somebody reads to decide what to send, and it used to sit
          below four headings. Same treatment the display's own Reko block
          gives it, so wall and board read alike. */}
      {report.summary_text && (
        <p className="text-base leading-snug">{report.summary_text}</p>
      )}

      {/* Dangers, effort, power and notes — ONE definition grid, muted
          label column, foreground value column. Gefahren sit in it like
          Mannschaft and Dauer (image #14); only the hazard chips carry the
          warning tint, so the highlight marks the fact, not the row. */}
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm leading-tight">
          {facts.map(({ label, value }) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      {/* Photos. Its heading is a label like every other label on the card:
          plain and muted, not the one bold thing in the box. */}
      {photos.length > 0 && (
        <div>
          <h5 className="text-xs text-muted-foreground mb-1.5">{t('photosCount', { count: photos.length })}</h5>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {photos.map((filename, index) => (
              <ReportPhoto
                key={filename}
                incidentId={incidentId}
                filename={filename}
                alt={report.submitted_by_personnel_name
                  ? t('photoAltBy', { number: index + 1, name: report.submitted_by_personnel_name })
                  : t('photoAlt', { number: index + 1 })}
                sizes="33vw"
                className="relative block aspect-square overflow-hidden rounded"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RekoReportCard({ report, incidentId, onRequestComplete, dense = false }: RekoReportCardProps) {
  const t = useTranslations('reko.reportSection')
  const facts = useReportFacts(report, dense)

  // «aktualisiert» compares the RENDERED stamps, not the raw ISO strings: a
  // submit and its own commit differ by milliseconds, and «Übermittelt 17:57 ·
  // aktualisiert 17:57» is a sentence that says nothing twice.
  const submittedStamp = formatStamp(report.submitted_at)
  const updatedStamp = formatStamp(report.updated_at)

  // «Kein Einsatz nötig» often IS the whole report — no verdict rule and no
  // body then, instead of a divider with nothing on the far side (image #20).
  const hasBody =
    Boolean(report.summary_text) ||
    facts.length > 0 ||
    Boolean(report.photos_json && report.photos_json.length > 0)

  if (dense) {
    return (
      <div>
        {/* The verdict line — the ONE thing that still marks a report as a
            message from outside rather than a form field. Name and stamps ride
            on it as muted text; the badge around the name was a third layer of
            chrome on a line that already has an icon. No hairline under it —
            whitespace separates it from the rows below, like everywhere else
            in the detail. */}
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', hasBody && 'pb-1.5')}>
          <VerdictIcon value={report.is_relevant} className="size-4 shrink-0" />
          <span className="text-sm font-semibold leading-tight">{t(verdictKey(report.is_relevant, 'long'))}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs leading-tight text-muted-foreground">
            {report.submitted_by_personnel_name && (
              <span className="flex items-center gap-1">
                <Binoculars className="size-3 shrink-0" />
                {report.submitted_by_personnel_name}
                <span aria-hidden="true">·</span>
              </span>
            )}
            {t('submittedShort', { time: submittedStamp })}
            {updatedStamp !== submittedStamp && ` · ${t('updatedShort', { time: updatedStamp })}`}
          </span>
          {/* Reko reported the incident not relevant — let the operator close it
              straight from the Reko-Meldung. */}
          {report.is_relevant === false && onRequestComplete && (
            <Button size="xs" variant="secondary" className="ml-auto" onClick={onRequestComplete}>
              <CheckCheck className="size-3.5" />
              {t('completeIncident')}
            </Button>
          )}
        </div>
        <RekoReportBody report={report} incidentId={incidentId} dense />
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <div className="p-3">
        {/* The verdict. Its bottom border does the job the standalone
            <Separator/> used to do one full row lower down.

            One leading system across the card: `snug` for the finding, which is
            prose and has to read well, `tight` for everything that is a label,
            a chip or a value. The verdict used to reserve a 24px line box for a
            16px word and pushed its own rule down with it. */}
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', hasBody && 'border-b pb-2 mb-3')}>
          <VerdictIcon value={report.is_relevant} className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium leading-tight">{t(verdictKey(report.is_relevant, 'long'))}</span>
          {/* Provenance rides on the verdict line, small and muted — the heavy
              three-part footer it replaces was a full row of chrome saying one
              line's worth of facts. «aktualisiert» only appears once it differs
              from the submit, because "unchanged" is not information. */}
          <span className="text-xs leading-tight text-muted-foreground">
            {t('submittedShort', { time: submittedStamp })}
            {updatedStamp !== submittedStamp && ` · ${t('updatedShort', { time: updatedStamp })}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {report.submitted_by_personnel_name && (
              <Badge variant="secondary" className="gap-1">
                <Binoculars className="h-3 w-3" />
                {report.submitted_by_personnel_name}
              </Badge>
            )}
            {/* Reko reported the incident not relevant — let the operator close it
                straight from the Reko-Meldung card. */}
            {report.is_relevant === false && onRequestComplete && (
              <Button
                size="xs"
                variant="secondary"
                onClick={onRequestComplete}
              >
                <CheckCheck className="size-3.5" />
                {t('completeIncident')}
              </Button>
            )}
          </div>
        </div>

        <RekoReportBody report={report} incidentId={incidentId} />
      </div>
    </div>
  )
}

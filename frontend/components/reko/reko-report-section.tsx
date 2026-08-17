'use client'

/**
 * The Reko block of the incident detail — a **read AND write** surface since
 * plan 26 §5.1.
 *
 * It used to be a renderer and nothing else: it could display a recon report
 * faithfully and produce none of it. `POST /api/reko/` took a per-incident form
 * token and had no user path, so an editor could not file one at all — and the
 * normal case is a radio message, because the crew has no signal in the cellar,
 * no free hands, or simply will not open an app at 02:00.
 *
 * It **expands in place**, collapsed until needed, the same shape
 * `SchadenplatzRapportSection` has one column over. Deliberately not a dialog:
 * that would be a modal over a modal, and it would hide the Feldmeldungen the
 * operator is reading from while dictating.
 *
 * "Reko-Bericht erfassen" appears on an incident that has **no report and never
 * had field contact** — the create-from-nothing case, which is this phase's
 * acceptance criterion. With a report present the button amends the existing one
 * (`PATCH`) instead of filing a second, so a crew's authorship survives and the
 * row carries both provenance lines.
 *
 * The "vor Ort seit …" line this section used to render is **gone** (decision
 * 15), not moved and not linked. `arrived_at` is displayed and written in
 * exactly one place now, the Feldmeldungen row — a fact shown twice is a fact
 * that will eventually disagree with itself. Accepted price: this block alone no
 * longer says whether Reko is on site.
 */

import { useState, useEffect, useCallback, useMemo, useRef, Fragment, type ReactNode } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Binoculars, FileText, ChevronDown, History, CheckCheck, Pencil, Plus, X } from 'lucide-react'
import { apiClient, type ApiRekoReportResponse } from '@/lib/api-client'
import { RekoReportForm, EMPTY_REKO_FORM, toRekoFormData, type RekoFormData } from '@/components/reko/reko-report-form'
import { getApiUrl } from '@/lib/env'
import { cn } from '@/lib/utils'
import { wsClient } from '@/lib/websocket-client'

interface RekoReportSectionProps {
  incidentId: string
  /** Editor-only: archive the incident (status → complete). When provided and the
      latest report is "nicht relevant", a "Einsatz abschliessen" button is shown. */
  onRequestComplete?: () => void
  /** Whether this mount may write. False on the phone, which is viewing-first. */
  canEdit?: boolean
  /**
   * `split` puts the filed reports in one column and the entry surface in the
   * other — the modal has the width, and in a two-column reading «was gemeldet
   * wurde» and «was ich erfasse» stop pushing each other down the page. The
   * panel stays stacked; 420px has no second column to give.
   */
  layout?: 'stacked' | 'split'
  /**
   * Rendered at the top of the DATA column — the Funkmeldung «Reko vor Ort».
   * It belongs beside the reports it is about, not across both columns above
   * them, where it read as a heading for the entry surface as well.
   */
  dataSlot?: ReactNode
  /**
   * Open the entry form on arrival. A NONCE rather than a boolean: the caller
   * that wants this is a deep link («Reko-Details öffnen» in the completion
   * gate), the same incident can be deep-linked twice in a session, and a
   * boolean that is already `true` cannot say "again". Ignored while the
   * mount cannot write.
   */
  openEditorNonce?: number
}

const POLL_INTERVAL_MS = 5000 // Poll every 5 seconds for new reports

export default function RekoReportSection({
  incidentId,
  onRequestComplete,
  canEdit = false,
  layout = 'stacked',
  dataSlot,
  openEditorNonce,
}: RekoReportSectionProps) {
  const split = layout === 'split'
  const t = useTranslations('reko.reportSection')
  const [reports, setReports] = useState<ApiRekoReportResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState<RekoFormData>(EMPTY_REKO_FORM)

  const loadReports = useCallback(async () => {
    try {
      const data = await apiClient.getIncidentRekoReports(incidentId)
      // Filter out drafts, only show submitted reports (newest first)
      setReports(data.filter(r => !r.is_draft))
    } catch (error) {
      console.error('Failed to load Reko reports:', error)
    } finally {
      setIsLoading(false)
    }
  }, [incidentId])

  // WebSocket for instant updates + an always-on safety-net poll.
  //
  // This section only mounts while a detail modal is open (per-incident, tiny
  // payload), so a low-frequency poll is cheap. We keep it running even while the
  // WebSocket is connected: the very first report often submits during the gap
  // between this component mounting and the single `reko_update` event arriving,
  // and with no fallback poll a missed event meant the report never showed until
  // the modal was reopened ("first emergency doesn't show right away").
  useEffect(() => {
    loadReports()

    // Listen for reko updates matching this incident (instant refresh)
    const unsubscribeReko = wsClient.on('reko_update', (data: { data: { incident_id?: string } }) => {
      if (data.data?.incident_id === incidentId) {
        loadReports()
      }
    })

    const pollInterval = setInterval(loadReports, POLL_INTERVAL_MS)

    return () => {
      unsubscribeReko()
      clearInterval(pollInterval)
    }
  }, [loadReports, incidentId])

  const latestReport: ApiRekoReportResponse | undefined = reports[0]
  const previousReports = reports.slice(1)

  /**
   * The board's photo door (§6.1, same case the Schadenplatz-Rapport already
   * covers): the crew has no signal at the Schadenplatz and sends the picture
   * over WhatsApp, so the operator attaches it to the report they are
   * transcribing. No token — the session is the credential, and the default
   * read path (`GET /api/photos/…`) is the session-authenticated one.
   */
  const photoTransport = useMemo(
    () => ({
      upload: async (file: File) =>
        (await apiClient.uploadRekoPhotoAsEditor(incidentId, file, latestReport?.id)).filename,
      remove: (filename: string) =>
        apiClient.deleteRekoPhotoAsEditor(incidentId, filename, latestReport?.id),
    }),
    [incidentId, latestReport?.id],
  )

  /** Open the form: amending starts from what is already there. */
  function startEditing() {
    setFormData(toRekoFormData(latestReport))
    setIsEditing(true)
  }

  // Deep-linked straight into the entry form. Waits for `isLoading`, because
  // `startEditing` prefills from `latestReport` and opening before the fetch
  // lands would give an amend an empty form. Keyed on the nonce so a second
  // deep link to the same incident opens it again — and so a later re-render
  // cannot re-open a form the operator has closed.
  const openedForNonce = useRef<number | null>(null)
  useEffect(() => {
    if (openEditorNonce === undefined || !canEdit || isLoading) return
    if (openedForNonce.current === openEditorNonce) return
    openedForNonce.current = openEditorNonce
    startEditing()
    // `startEditing` is a plain function redeclared every render; the nonce guard
    // above is what makes this run once per deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEditorNonce, canEdit, isLoading])

  async function handleSave() {
    setIsSaving(true)
    try {
      // The report's own fields; no token, the session is the identity. Photos
      // travel too: the upload already attached them server-side, and sending
      // the list keeps a photo removed in the open form removed on save.
      const payload = {
        is_relevant: formData.is_relevant,
        dangers_json: formData.dangers_json,
        effort_json: formData.effort_json,
        power_supply: formData.power_supply,
        photos_json: formData.photos_json,
        summary_text: formData.summary_text,
        additional_notes: formData.additional_notes,
      }
      if (latestReport) {
        // An amendment, not a second report: the crew keeps its authorship and
        // the operator is added next to it (§5.3).
        await apiClient.updateRekoReport(latestReport.id, payload)
      } else {
        await apiClient.createRekoReportAsEditor(incidentId, payload)
      }
      await loadReports()
      setIsEditing(false)
      toast.success(t('saved'))
    } catch (error) {
      console.error('Failed to save Reko report:', error)
      toast.error(t('saveFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className={cn(split ? "grid grid-cols-2 gap-6" : "space-y-2")}>
      <div className="space-y-2">
      {dataSlot}
      {latestReport ? (
        <>
          {/* Latest Report - Full display */}
          <RekoReportCard
            report={latestReport}
            incidentId={incidentId}
            onRequestComplete={onRequestComplete}
          />

          {/* Previous Reports - Collapsible */}
          {previousReports.length > 0 && (
            <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted/50" tabIndex={-1}>
                <History className="h-3 w-3" />
                <span>{t('previousReports', { count: previousReports.length })}</span>
                <ChevronDown className={cn("h-3 w-3 ml-auto transition-transform", historyOpen && "rotate-180")} />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-1">
                {previousReports.map((report) => (
                  <RekoReportCardCompact
                    key={report.id}
                    report={report}
                    incidentId={incidentId}
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      ) : (
        // While stacked, the placeholder gives way to the form opening below
        // it; side by side the columns are independent, and an empty column
        // that says nothing reads as a rendering fault.
        (split || !isEditing) && (
          <div className="rounded-lg border border-dashed p-3 flex items-center justify-center gap-2 text-muted-foreground">
            <FileText className="h-4 w-4 shrink-0" />
            <p className="text-sm">{t('noReport')}</p>
          </div>
        )
      )}

      </div>

      {/* The editing surface. In place, not a dialog — a modal over the incident
          detail would hide the Feldmeldungen the operator is dictating from.
          Its own column when there is one, so a long report and a long form do
          not queue up behind each other. */}
      <div className={cn(split && "border-l border-border pl-6", !split && "space-y-2")}>
      {canEdit && (
        isEditing ? (
          // No card in the split layout: the column IS the frame, and a border
          // inside a border inside the modal is two frames around one form.
          <div className={cn("space-y-3", split ? "" : "rounded-lg border border-border p-4")}>
            <div className="flex items-center gap-2">
              <Binoculars className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-semibold text-muted-foreground">
                {latestReport ? t('amendTitle') : t('createTitle')}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="ml-auto"
                disabled={isSaving}
                onClick={() => setIsEditing(false)}
              >
                <X className="size-3.5" />
                {t('cancel')}
              </Button>
            </div>
            {/* Says out loud which channel this is, so nothing about the
                resulting report reads as a crew report. */}
            <p className="text-xs text-muted-foreground">{t('radioHint')}</p>
            <RekoReportForm
              incidentId={incidentId}
              value={formData}
              onChange={setFormData}
              photos={photoTransport}
              mount="kp"
              isSubmitting={isSaving}
              onSubmit={handleSave}
            />
          </div>
        ) : (
          <Button type="button" size="xs" variant="outline" onClick={startEditing}>
            {latestReport ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
            {latestReport ? t('amend') : t('create')}
          </Button>
        )
      )}
      </div>
    </div>
  )
}

interface RekoReportCardProps {
  report: ApiRekoReportResponse
  incidentId: string
  onRequestComplete?: () => void
}

/**
 * A report timestamp, to the minute. Nobody reads a Reko-Bericht to the second,
 * and `toLocaleString()`'s default seconds were what pushed the provenance
 * footer onto a second line as soon as the submitter's name stood next to it.
 */
function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function RekoReportCard({ report, incidentId, onRequestComplete }: RekoReportCardProps) {
  const t = useTranslations('reko.reportSection')
  function getPhotoUrl(filename: string): string {
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  /**
   * The numbered facts, as `{ label, value }` pairs rather than pre-composed
   * «Label: Wert» strings. They render as a two-column definition grid: in a
   * wrapping row every value started at whatever x the previous string happened
   * to end at, and no two lines agreed on anything. One label column and one
   * value column let the eye run straight down the values.
   *
   * «Zusätzliche Notizen» is the last pair and not a separately styled
   * paragraph — it is a label and a value like the rest, and one emphasis rule
   * for all of them beats a bold label here and a plain one there.
   */
  const facts: { label: string; value: string }[] = []
  if (report.effort_json?.personnel_count) {
    facts.push({
      label: t('personnelLabel'),
      value: t('personnelValue', { count: report.effort_json.personnel_count }),
    })
  }
  if (report.effort_json?.estimated_duration_hours) {
    facts.push({
      label: t('durationLabel'),
      value: t('durationValue', { hours: report.effort_json.estimated_duration_hours }),
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
    facts.push({ label: t('additionalNotes'), value: report.additional_notes })
  }

  const dangers = report.dangers_json
  const dangerLabels: string[] = []
  if (dangers?.fire) dangerLabels.push(t('dangerBadges.fire'))
  if (dangers?.fire_danger) dangerLabels.push(t('dangerBadges.fire_danger'))
  if (dangers?.explosion) dangerLabels.push(t('dangerBadges.explosion'))
  if (dangers?.collapse) dangerLabels.push(t('dangerBadges.collapse'))
  if (dangers?.chemical) dangerLabels.push(t('dangerBadges.chemical'))
  if (dangers?.electrical) dangerLabels.push(t('dangerBadges.electrical'))
  const hasDangers = dangerLabels.length > 0 || !!dangers?.other_notes

  return (
    <div className="rounded-lg border">
      <div className="p-3">
        {/* The verdict. Its bottom border does the job the standalone
            <Separator/> used to do one full row lower down.

            One leading system across the card: `snug` for the finding, which is
            prose and has to read well, `tight` for everything that is a label,
            a chip or a value. The verdict used to reserve a 24px line box for a
            16px word and pushed its own rule down with it. */}
        <div className="flex items-center gap-2 border-b pb-2 mb-3">
          {report.is_relevant ? (
            <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
          <span className="font-medium leading-tight">
            {report.is_relevant ? t('relevant') : t('notNeeded')}
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
            {!report.is_relevant && onRequestComplete && (
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

        <div className="space-y-3">
          {/* The finding leads, one size above the facts around it — it is the
              sentence somebody reads to decide what to send, and it used to sit
              below four headings. Same treatment the display's own Reko block
              gives it, so wall and board read alike. */}
          {report.summary_text && (
            <p className="text-base leading-snug">{report.summary_text}</p>
          )}

          {/* Dangers — label and chips share the row; the word stays, so nothing
              here is a bare icon.

              Warning-toned outline chips, not solid `destructive` pills: a
              saturated red block was the brightest object on the card and it
              outshouted the finding above it, which is the sentence somebody
              reads to decide what to send. The board card and the wall card
              already render this same danger list as outline badges, and the
              display's own Reko block already tints it warning — this is those
              two put together, so one danger looks like one danger wherever it
              is read. The note below is a fact, not an aside, and reads in the
              foreground like every other value on the card. */}
          {hasDangers && (
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                  {t('dangers')}
                </span>
                {dangerLabels.map((label) => (
                  <Badge
                    key={label}
                    variant="outline"
                    className="border-warning/40 bg-warning/10 text-warning-foreground"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
              {dangers?.other_notes && (
                <p className="text-sm leading-tight">{dangers.other_notes}</p>
              )}
            </div>
          )}

          {/* Effort, power and notes — one definition grid, muted label column,
              foreground value column. */}
          {facts.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm leading-tight">
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
          {report.photos_json && report.photos_json.length > 0 && (
            <div>
              <h5 className="text-xs text-muted-foreground mb-1.5">{t('photosCount', { count: report.photos_json.length })}</h5>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {report.photos_json.map((filename, index) => (
                  <a
                    key={index}
                    href={getPhotoUrl(filename)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative block aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                    tabIndex={-1}
                  >
                    {/* unoptimized: photos come from the backend at a
                        runtime-determined origin, which Next's optimizer cannot
                        resolve (hosts are configured at build time). */}
                    <Image
                      src={getPhotoUrl(filename)}
                      alt={report.submitted_by_personnel_name
                        ? t('photoAltBy', { number: index + 1, name: report.submitted_by_personnel_name })
                        : t('photoAlt', { number: index + 1 })}
                      fill
                      sizes="33vw"
                      unoptimized
                      className="object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Provenance, one wrapping row: two timestamps are one line's worth
              of information. */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground border-t pt-2">
            {report.submitted_by_personnel_name && (
              <span>{t('rekoBy', { name: report.submitted_by_personnel_name })}</span>
            )}
            <span>{t('submittedAt', { date: formatStamp(report.submitted_at) })}</span>
            {report.updated_at !== report.submitted_at && (
              <span>{t('updatedAt', { date: formatStamp(report.updated_at) })}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Compact version for previous reports
function RekoReportCardCompact({ report }: RekoReportCardProps) {
  const t = useTranslations('reko.reportSection')

  const hasDangers = report.dangers_json && (
    report.dangers_json.fire ||
    report.dangers_json.fire_danger ||
    report.dangers_json.explosion ||
    report.dangers_json.collapse ||
    report.dangers_json.chemical ||
    report.dangers_json.electrical
  )

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
      <div className="flex items-start gap-2">
        {report.is_relevant ? (
          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-xs">
              {report.is_relevant ? t('relevantShort') : t('notRelevantShort')}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(report.submitted_at).toLocaleDateString('de-CH')}
            </span>
          </div>

          {/* Compact info row */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {report.submitted_by_personnel_name && (
              <span className="flex items-center gap-1">
                <Binoculars className="h-3 w-3" />
                {report.submitted_by_personnel_name}
              </span>
            )}
            {/* Same warning tone the current report's card uses — the history
                row was the last place a Reko danger still read as red. */}
            {hasDangers && (
              <span className="flex items-center gap-1 text-warning-foreground">
                <AlertTriangle className="h-3 w-3" />
                {t('dangers')}
              </span>
            )}
            {report.photos_json && report.photos_json.length > 0 && (
              <span>{t('photoCount', { count: report.photos_json.length })}</span>
            )}
          </div>

          {/* Summary if exists */}
          {report.summary_text && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {report.summary_text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

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

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CheckCircle2, XCircle, AlertTriangle, Users, Zap, Loader2, Binoculars, FileText, ChevronDown, History, CheckCheck, Pencil, Plus, X } from 'lucide-react'
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
}

const POLL_INTERVAL_MS = 5000 // Poll every 5 seconds for new reports

export default function RekoReportSection({
  incidentId,
  onRequestComplete,
  canEdit = false,
  layout = 'stacked',
  dataSlot,
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

function RekoReportCard({ report, incidentId, onRequestComplete }: RekoReportCardProps) {
  const t = useTranslations('reko.reportSection')
  function getPhotoUrl(filename: string): string {
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  return (
    <div className="rounded-lg border">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          {report.is_relevant ? (
            <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                {report.is_relevant ? t('relevant') : t('notNeeded')}
              </span>
              <div className="flex items-center gap-2">
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
          </div>
        </div>

        <div className="space-y-4">
          <Separator />

          {/* Dangers */}
          {report.dangers_json && (
            report.dangers_json.fire ||
            report.dangers_json.fire_danger ||
            report.dangers_json.explosion ||
            report.dangers_json.collapse ||
            report.dangers_json.chemical ||
            report.dangers_json.electrical ||
            report.dangers_json.other_notes
          ) && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                {t('dangers')}
              </h5>
              <div className="flex flex-wrap gap-2">
                {report.dangers_json.fire && <Badge variant="destructive">{t('dangerBadges.fire')}</Badge>}
                {report.dangers_json.fire_danger && <Badge variant="destructive">{t('dangerBadges.fire_danger')}</Badge>}
                {report.dangers_json.explosion && <Badge variant="destructive">{t('dangerBadges.explosion')}</Badge>}
                {report.dangers_json.collapse && <Badge variant="destructive">{t('dangerBadges.collapse')}</Badge>}
                {report.dangers_json.chemical && <Badge variant="destructive">{t('dangerBadges.chemical')}</Badge>}
                {report.dangers_json.electrical && <Badge variant="destructive">{t('dangerBadges.electrical')}</Badge>}
              </div>
              {report.dangers_json.other_notes && (
                <p className="text-sm text-muted-foreground mt-2">
                  {report.dangers_json.other_notes}
                </p>
              )}
            </div>
          )}

          {/* Effort */}
          {report.effort_json && (
            report.effort_json.personnel_count ||
            report.effort_json.estimated_duration_hours ||
            report.effort_json.vehicles_needed?.length > 0 ||
            report.effort_json.equipment_needed?.length > 0
          ) && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                {t('effort')}
              </h5>
              <div className="text-sm space-y-1">
                {report.effort_json.personnel_count && (
                  <p>{t('personnel', { count: report.effort_json.personnel_count })}</p>
                )}
                {report.effort_json.estimated_duration_hours && (
                  <p>{t('duration', { hours: report.effort_json.estimated_duration_hours })}</p>
                )}
                {report.effort_json.vehicles_needed && report.effort_json.vehicles_needed.length > 0 && (
                  <p>{t('vehicles', { list: report.effort_json.vehicles_needed.join(', ') })}</p>
                )}
                {report.effort_json.equipment_needed && report.effort_json.equipment_needed.length > 0 && (
                  <p>{t('equipment', { list: report.effort_json.equipment_needed.join(', ') })}</p>
                )}
              </div>
            </div>
          )}

          {/* Power Supply */}
          {report.power_supply && report.power_supply !== 'unknown' && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                {t('powerSupply')}
              </h5>
              <p className="text-sm">
                {report.power_supply === 'available' && t('powerAvailable')}
                {report.power_supply === 'unavailable' && t('powerUnavailable')}
                {report.power_supply === 'emergency_needed' && t('powerEmergencyNeeded')}
              </p>
            </div>
          )}

          {/* Photos */}
          {report.photos_json && report.photos_json.length > 0 && (
            <div>
              <h5 className="font-medium text-sm mb-2">{t('photosCount', { count: report.photos_json.length })}</h5>
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

          {/* Summary - show text directly without label */}
          {report.summary_text && (
            <div>
              <p className="text-sm">{report.summary_text}</p>
            </div>
          )}

          {/* Additional Notes */}
          {report.additional_notes && (
            <div>
              <h5 className="font-medium text-sm mb-2">{t('additionalNotes')}</h5>
              <p className="text-sm text-muted-foreground">{report.additional_notes}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-muted-foreground border-t pt-2 mt-4">
            {report.submitted_by_personnel_name && (
              <p>{t('rekoBy', { name: report.submitted_by_personnel_name })}</p>
            )}
            <p>{t('submittedAt', { date: new Date(report.submitted_at).toLocaleString('de-CH') })}</p>
            {report.updated_at !== report.submitted_at && (
              <p>{t('updatedAt', { date: new Date(report.updated_at).toLocaleString('de-CH') })}</p>
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
            {hasDangers && (
              <span className="flex items-center gap-1 text-destructive">
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

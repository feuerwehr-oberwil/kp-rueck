'use client'

import { useState, useEffect, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, XCircle, AlertTriangle, Users, Zap, Loader2, Binoculars, FileText } from 'lucide-react'
import { apiClient, type ApiRekoReportResponse } from '@/lib/api-client'
import { getApiUrl } from '@/lib/env'

interface RekoReportSectionProps {
  incidentId: string
}

const POLL_INTERVAL_MS = 5000 // Poll every 5 seconds for new reports

export default function RekoReportSection({ incidentId }: RekoReportSectionProps) {
  const [reports, setReports] = useState<ApiRekoReportResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadReports = useCallback(async () => {
    try {
      const data = await apiClient.getIncidentRekoReports(incidentId)
      // Filter out drafts, only show submitted reports
      setReports(data.filter(r => !r.is_draft))
    } catch (error) {
      console.error('Failed to load Reko reports:', error)
    } finally {
      setIsLoading(false)
    }
  }, [incidentId])

  // Initial load and polling for updates
  useEffect(() => {
    loadReports()

    // Set up polling interval for live updates
    const pollInterval = setInterval(loadReports, POLL_INTERVAL_MS)

    return () => clearInterval(pollInterval)
  }, [loadReports])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 flex items-center justify-center gap-2 text-muted-foreground">
        <FileText className="h-4 w-4" />
        <p className="text-sm">Noch keine Reko-Meldung</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {reports.map((report) => (
        <RekoReportCard
          key={report.id}
          report={report}
          incidentId={incidentId}
        />
      ))}
    </div>
  )
}

interface RekoReportCardProps {
  report: ApiRekoReportResponse
  incidentId: string
}

function RekoReportCard({ report, incidentId }: RekoReportCardProps) {
  function getPhotoUrl(filename: string): string {
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  return (
    <div className="rounded-lg border">
      <div className="p-4">
        <div className="flex items-center gap-3 mb-4">
          {report.is_relevant ? (
            <CheckCircle2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Reko-Meldung</h4>
              {report.submitted_by_personnel_name && (
                <Badge variant="secondary" className="gap-1">
                  <Binoculars className="h-3 w-3" />
                  {report.submitted_by_personnel_name}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {report.is_relevant ? 'Einsatz relevant' : 'Kein Einsatz nötig'}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Separator />

          {/* Dangers */}
          {report.dangers_json && (
            report.dangers_json.fire ||
            report.dangers_json.explosion ||
            report.dangers_json.collapse ||
            report.dangers_json.chemical ||
            report.dangers_json.electrical ||
            report.dangers_json.other_notes
          ) && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                Gefahren
              </h5>
              <div className="flex flex-wrap gap-2">
                {report.dangers_json.fire && <Badge variant="destructive">Feuer</Badge>}
                {report.dangers_json.explosion && <Badge variant="destructive">Explosion</Badge>}
                {report.dangers_json.collapse && <Badge variant="destructive">Einsturz</Badge>}
                {report.dangers_json.chemical && <Badge variant="destructive">Gefahrstoffe</Badge>}
                {report.dangers_json.electrical && <Badge variant="destructive">Elektrisch</Badge>}
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
                Aufwand
              </h5>
              <div className="text-sm space-y-1">
                {report.effort_json.personnel_count && (
                  <p>Personal: {report.effort_json.personnel_count} Personen</p>
                )}
                {report.effort_json.estimated_duration_hours && (
                  <p>Dauer: {report.effort_json.estimated_duration_hours} Stunden</p>
                )}
                {report.effort_json.vehicles_needed && report.effort_json.vehicles_needed.length > 0 && (
                  <p>Fahrzeuge: {report.effort_json.vehicles_needed.join(', ')}</p>
                )}
                {report.effort_json.equipment_needed && report.effort_json.equipment_needed.length > 0 && (
                  <p>Ausrüstung: {report.effort_json.equipment_needed.join(', ')}</p>
                )}
              </div>
            </div>
          )}

          {/* Power Supply */}
          {report.power_supply && report.power_supply !== 'unknown' && (
            <div>
              <h5 className="font-medium text-sm mb-2 flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                Stromversorgung
              </h5>
              <p className="text-sm">
                {report.power_supply === 'available' && 'Vorhanden'}
                {report.power_supply === 'unavailable' && 'Nicht vorhanden'}
                {report.power_supply === 'emergency_needed' && 'Notstrom benötigt'}
              </p>
            </div>
          )}

          {/* Photos */}
          {report.photos_json && report.photos_json.length > 0 && (
            <div>
              <h5 className="font-medium text-sm mb-2">Fotos ({report.photos_json.length})</h5>
              <div className="grid grid-cols-3 gap-2">
                {report.photos_json.map((filename, index) => (
                  <a
                    key={index}
                    href={getPhotoUrl(filename)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                  >
                    <img
                      src={getPhotoUrl(filename)}
                      alt={`Reko photo ${index + 1}`}
                      className="w-full h-full object-cover"
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
              <h5 className="font-medium text-sm mb-2">Zusätzliche Notizen</h5>
              <p className="text-sm text-muted-foreground">{report.additional_notes}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="text-xs text-muted-foreground border-t pt-2 mt-4">
            {report.submitted_by_personnel_name && (
              <p>Reko von: {report.submitted_by_personnel_name}</p>
            )}
            <p>Übermittelt: {new Date(report.submitted_at).toLocaleString('de-CH')}</p>
            {report.updated_at !== report.submitted_at && (
              <p>Aktualisiert: {new Date(report.updated_at).toLocaleString('de-CH')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

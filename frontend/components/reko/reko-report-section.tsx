'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle, Users, Zap, Loader2 } from 'lucide-react'
import { apiClient, type ApiRekoReportResponse } from '@/lib/api-client'
import { getApiUrl } from '@/lib/env'
import Image from 'next/image'
import RekoQRCode from './reko-qr-code'

interface RekoReportSectionProps {
  incidentId: string
}

export default function RekoReportSection({ incidentId }: RekoReportSectionProps) {
  const [reports, setReports] = useState<ApiRekoReportResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null)

  useEffect(() => {
    loadReports()
  }, [incidentId])

  async function loadReports() {
    try {
      const data = await apiClient.getIncidentRekoReports(incidentId)
      // Filter out drafts, only show submitted reports
      setReports(data.filter(r => !r.is_draft))
    } catch (error) {
      console.error('Failed to load Reko reports:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground mb-2">Keine Reko-Meldung vorhanden</p>
        <RekoQRCode incidentId={incidentId} />
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
          isExpanded={expandedReportId === report.id}
          onToggle={() => setExpandedReportId(expandedReportId === report.id ? null : report.id)}
        />
      ))}
      <div className="pt-2">
        <RekoQRCode incidentId={incidentId} />
      </div>
    </div>
  )
}

interface RekoReportCardProps {
  report: ApiRekoReportResponse
  incidentId: string
  isExpanded: boolean
  onToggle: () => void
}

function RekoReportCard({ report, incidentId, isExpanded, onToggle }: RekoReportCardProps) {
  function getPhotoUrl(filename: string): string {
    const apiUrl = getApiUrl()
    return `${apiUrl}/api/photos/${incidentId}/${filename}`
  }

  return (
    <div className="rounded-lg border">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-accent transition-colors"
      >
        <div className="flex items-center gap-3">
          {report.is_relevant ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          )}
          <div className="text-left">
            <h4 className="font-semibold">Reko-Meldung</h4>
            <p className="text-sm text-muted-foreground">
              {report.is_relevant ? 'Einsatz relevant' : 'Kein Einsatz nötig'}
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {isExpanded && (
        <div className="p-4 pt-0 space-y-4">
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
                <AlertTriangle className="h-4 w-4 text-orange-600" />
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
                    className="relative aspect-square rounded overflow-hidden hover:opacity-80 transition-opacity"
                  >
                    <Image
                      src={getPhotoUrl(filename)}
                      alt={`Reko photo ${index + 1}`}
                      fill
                      className="object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          {report.summary_text && (
            <div>
              <h5 className="font-medium text-sm mb-2">Zusammenfassung</h5>
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
            <p>Übermittelt: {new Date(report.submitted_at).toLocaleString('de-CH')}</p>
            {report.updated_at !== report.submitted_at && (
              <p>Aktualisiert: {new Date(report.updated_at).toLocaleString('de-CH')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

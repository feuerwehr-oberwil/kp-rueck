'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiClient, type ApiRekoReportResponse } from '@/lib/api-client'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useEvent } from '@/lib/contexts/event-context'

/**
 * Hook to track and notify users of new Reko reports across all incidents
 */
export function useRekoNotifications(incidents: Array<{ id: string }>) {
  const { selectedEvent } = useEvent()
  const [seenRekoIds, setSeenRekoIds] = useState<Set<string>>(new Set())
  const isInitialLoad = useRef(true)

  useEffect(() => {
    if (!selectedEvent || incidents.length === 0) {
      return
    }

    const checkForNewRekos = async () => {
      try {
        // Fetch all reko reports for all incidents
        const allReports = await Promise.all(
          incidents.map(async (incident) => {
            try {
              const reports = await apiClient.getIncidentRekoReports(incident.id)
              return reports.filter(r => !r.is_draft) // Only submitted reports
            } catch {
              return []
            }
          })
        )

        const flatReports = allReports.flat()

        // On initial load, just mark all as seen without notifications
        if (isInitialLoad.current) {
          setSeenRekoIds(new Set(flatReports.map(r => r.id)))
          isInitialLoad.current = false
          return
        }

        // Check for new reports
        const newReports = flatReports.filter(report => !seenRekoIds.has(report.id))

        if (newReports.length > 0) {
          // Update seen IDs
          setSeenRekoIds(new Set(flatReports.map(r => r.id)))

          // Show persistent toast for each new report
          newReports.forEach((report) => {
            const incidentTitle = report.incident_title || 'Unbekannter Einsatz'
            const isRelevant = report.is_relevant

            toast(
              <div className="flex items-start gap-3">
                {isRelevant ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="font-semibold">Neue Reko-Meldung</div>
                  <div className="text-sm text-muted-foreground">{incidentTitle}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {isRelevant ? 'Einsatz relevant' : 'Kein Einsatz nötig'}
                  </div>
                </div>
              </div>,
              {
                duration: Infinity, // Persistent - user must dismiss
                action: {
                  label: 'Ansehen',
                  onClick: () => {
                    // Scroll to the incident card (if visible)
                    const element = document.querySelector(`[data-incident-id="${report.incident_id}"]`)
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  },
                },
              }
            )
          })
        }
      } catch (error) {
        console.error('Failed to check for new rekos:', error)
      }
    }

    // Check immediately and then every 3 seconds
    checkForNewRekos()
    const interval = setInterval(checkForNewRekos, 3000)

    return () => clearInterval(interval)
  }, [incidents, selectedEvent, seenRekoIds])
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { apiClient, type ApiRekoReportResponse } from '@/lib/api-client'
import { useEvent } from '@/lib/contexts/event-context'
import { useNotifications } from '@/lib/contexts/notification-context'
import type { Operation } from '@/lib/contexts/operations-context'

/**
 * Hook to track new Reko reports across all incidents and update operation state.
 * Notifications are now handled by the backend notification system and shown in the sidebar.
 */
export function useRekoNotifications(
  incidents: Array<{ id: string }>,
  onOpenIncidentModal?: (incidentId: string) => void,
  onUpdateOperationReko?: (incidentId: string, rekoSummary: {
    isRelevant: boolean
    hasDangers: boolean
    dangerTypes: string[]
    personnelCount: number | null
    estimatedDuration: number | null
  }) => void
) {
  const { selectedEvent } = useEvent()
  const { refetchNotifications } = useNotifications()
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

          // Update operation state for each new report
          newReports.forEach((report) => {
            // Extract danger types
            const dangerTypes: string[] = []
            if (report.dangers_json) {
              if (report.dangers_json.fire) dangerTypes.push("Feuer")
              if (report.dangers_json.explosion) dangerTypes.push("Explosion")
              if (report.dangers_json.collapse) dangerTypes.push("Einsturz")
              if (report.dangers_json.chemical) dangerTypes.push("Gefahrstoffe")
              if (report.dangers_json.electrical) dangerTypes.push("Elektrisch")
            }

            // Update operation with REKO summary immediately
            if (onUpdateOperationReko && report.incident_id) {
              onUpdateOperationReko(report.incident_id, {
                isRelevant: report.is_relevant ?? false,
                hasDangers: dangerTypes.length > 0,
                dangerTypes,
                personnelCount: report.effort_json?.personnel_count ?? null,
                estimatedDuration: report.effort_json?.estimated_duration_hours ?? null,
              })
            }
          })

          // Trigger notification refetch to show new reko notifications in sidebar
          refetchNotifications()
        }
      } catch (error) {
        console.error('Failed to check for new rekos:', error)
      }
    }

    // Check immediately and then every 10 seconds (aligned with main polling interval)
    checkForNewRekos()
    const interval = setInterval(checkForNewRekos, 10000)

    return () => clearInterval(interval)
  }, [incidents, selectedEvent, seenRekoIds, refetchNotifications])
}

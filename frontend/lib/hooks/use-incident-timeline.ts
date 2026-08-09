"use client"

import { useCallback, useEffect, useState } from "react"

import { apiClient, type ApiIncidentTimelineEvent } from "@/lib/api-client"

export interface IncidentTimelineState {
  /** Newest first, as the API returns it. */
  events: ApiIncidentTimelineEvent[] | null
  isLoading: boolean
  failed: boolean
  reload: () => void
}

/**
 * The incident's merged history: status changes, assignments and the crew's
 * Freitext-Meldungen.
 *
 * Fetched **once per detail view** and shared, because two surfaces read the
 * same feed: the Verlauf tab renders all of it, the Rapport tab renders only
 * the messages as a thread next to the Feldmeldungen. Two components fetching
 * the same endpoint would double every board click.
 *
 * `enabled` is what keeps that click cheap — the caller turns it on when one of
 * those two tabs is actually in front, and every re-enable refetches. A history
 * panel that quietly stopped updating while a running incident sat open is
 * worse than one that takes a moment to appear.
 */
export function useIncidentTimeline(incidentId: string | null, enabled: boolean): IncidentTimelineState {
  const [events, setEvents] = useState<ApiIncidentTimelineEvent[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (!incidentId) return
    setIsLoading(true)
    setFailed(false)
    try {
      const result = await apiClient.getIncidentTimeline(incidentId)
      setEvents(result.events)
    } catch (error) {
      // Non-fatal: this is history, not the board. The surfaces show a retry
      // rather than a toast — nothing the operator was doing has failed.
      console.error("Failed to load timeline:", error)
      setFailed(true)
    } finally {
      setIsLoading(false)
    }
  }, [incidentId])

  // A different incident must never show the previous one's history for the
  // frame before the refetch lands.
  useEffect(() => {
    setEvents(null)
    setFailed(false)
  }, [incidentId])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  return { events, isLoading, failed, reload: () => void load() }
}

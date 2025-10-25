'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { apiClient, type ApiEvent } from '@/lib/api-client'
import type { Event, EventCreate, EventUpdate } from '@/lib/types/incidents'

interface EventContextType {
  selectedEvent: Event | null
  setSelectedEvent: (event: Event | null) => void
  events: Event[]
  isLoading: boolean
  error: string | null
  refreshEvents: () => Promise<void>
  createEvent: (name: string, trainingFlag: boolean) => Promise<Event>
  archiveEvent: (eventId: string) => Promise<void>
  deleteEvent: (eventId: string) => Promise<void>
}

const EventContext = createContext<EventContextType | undefined>(undefined)

const SELECTED_EVENT_KEY = 'kp-rueck-selected-event'

/**
 * Convert API event to frontend Event type
 */
const apiEventToEvent = (apiEvent: ApiEvent): Event => ({
  id: apiEvent.id,
  name: apiEvent.name,
  training_flag: apiEvent.training_flag,
  created_at: new Date(apiEvent.created_at),
  updated_at: new Date(apiEvent.updated_at),
  archived_at: apiEvent.archived_at ? new Date(apiEvent.archived_at) : null,
  last_activity_at: new Date(apiEvent.last_activity_at),
  incident_count: apiEvent.incident_count,
})

export function EventProvider({ children }: { children: React.ReactNode }) {
  const [selectedEvent, setSelectedEventState] = useState<Event | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load selected event from localStorage on mount
  useEffect(() => {
    const savedEventId = localStorage.getItem(SELECTED_EVENT_KEY)
    if (savedEventId) {
      apiClient.getEvent(savedEventId)
        .then(apiEvent => setSelectedEventState(apiEventToEvent(apiEvent)))
        .catch(err => {
          console.error('Failed to load saved event:', err)
          localStorage.removeItem(SELECTED_EVENT_KEY)
        })
    }
  }, [])

  // Save selected event to localStorage when it changes
  const setSelectedEvent = useCallback((event: Event | null) => {
    setSelectedEventState(event)
    if (event) {
      localStorage.setItem(SELECTED_EVENT_KEY, event.id)
    } else {
      localStorage.removeItem(SELECTED_EVENT_KEY)
    }
  }, [])

  const refreshEvents = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await apiClient.getEvents(false) // Exclude archived
      setEvents(response.events.map(apiEventToEvent))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const createEvent = useCallback(async (name: string, trainingFlag: boolean): Promise<Event> => {
    const apiEvent = await apiClient.createEvent({ name, training_flag: trainingFlag })
    const event = apiEventToEvent(apiEvent)
    await refreshEvents()
    return event
  }, [refreshEvents])

  const archiveEvent = useCallback(async (eventId: string) => {
    await apiClient.archiveEvent(eventId)
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(null)
    }
    await refreshEvents()
  }, [selectedEvent, setSelectedEvent, refreshEvents])

  const deleteEvent = useCallback(async (eventId: string) => {
    await apiClient.deleteEvent(eventId)
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(null)
    }
    await refreshEvents()
  }, [selectedEvent, setSelectedEvent, refreshEvents])

  // Load events on mount
  useEffect(() => {
    refreshEvents()
  }, [refreshEvents])

  return (
    <EventContext.Provider
      value={{
        selectedEvent,
        setSelectedEvent,
        events,
        isLoading,
        error,
        refreshEvents,
        createEvent,
        archiveEvent,
        deleteEvent,
      }}
    >
      {children}
    </EventContext.Provider>
  )
}

export function useEvent() {
  const context = useContext(EventContext)
  if (!context) {
    throw new Error('useEvent must be used within EventProvider')
  }
  return context
}

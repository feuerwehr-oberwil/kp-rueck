'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { apiClient, type ApiEvent } from '@/lib/api-client'
import type { Event, EventCreate, EventUpdate } from '@/lib/types/incidents'
import { useAuth } from './auth-context'

interface EventContextType {
  selectedEvent: Event | null
  setSelectedEvent: (event: Event | null) => void
  events: Event[]
  isLoading: boolean
  isEventLoaded: boolean // Track if localStorage event has been loaded
  error: string | null
  refreshEvents: () => Promise<void>
  createEvent: (name: string, trainingFlag: boolean, autoAttachDivera?: boolean) => Promise<Event>
  archiveEvent: (eventId: string) => Promise<void>
  unarchiveEvent: (eventId: string) => Promise<void>
  deleteEvent: (eventId: string) => Promise<void>
}

const EventContext = createContext<EventContextType | undefined>(undefined)

const SELECTED_EVENT_KEY = 'kp-rueck-selected-event'

// Simple UUID validation to prevent invalid IDs from being used
const isValidUUID = (id: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

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
  const { isAuthenticated, loading: authLoading } = useAuth()
  const [selectedEvent, setSelectedEventState] = useState<Event | null>(null)
  const [events, setEvents] = useState<Event[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isEventLoaded, setIsEventLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load selected event from localStorage on mount (only when authenticated)
  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      return
    }

    const savedEventId = localStorage.getItem(SELECTED_EVENT_KEY)
    if (savedEventId) {
      // Validate that the saved ID is a valid UUID before making API call
      if (!isValidUUID(savedEventId)) {
        console.warn('Invalid event ID in localStorage, removing:', savedEventId)
        localStorage.removeItem(SELECTED_EVENT_KEY)
        setIsEventLoaded(true)
        return
      }

      apiClient.getEvent(savedEventId)
        .then(apiEvent => setSelectedEventState(apiEventToEvent(apiEvent)))
        .catch(err => {
          console.error('Failed to load saved event:', err)
          localStorage.removeItem(SELECTED_EVENT_KEY)
        })
        .finally(() => setIsEventLoaded(true))
    } else {
      setIsEventLoaded(true)
    }
  }, [authLoading, isAuthenticated])

  // Save selected event to localStorage when it changes
  const setSelectedEvent = useCallback((event: Event | null) => {
    setSelectedEventState(event)
    if (event) {
      // Validate event ID before saving to localStorage
      if (event.id && isValidUUID(event.id)) {
        localStorage.setItem(SELECTED_EVENT_KEY, event.id)
      } else {
        console.warn('Attempted to save invalid event ID to localStorage:', event.id)
        localStorage.removeItem(SELECTED_EVENT_KEY)
      }
    } else {
      localStorage.removeItem(SELECTED_EVENT_KEY)
    }
  }, [])

  const refreshEvents = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await apiClient.getEvents(true) // Include archived
      setEvents(response.events.map(apiEventToEvent))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const createEvent = useCallback(async (name: string, trainingFlag: boolean, autoAttachDivera: boolean = false): Promise<Event> => {
    const apiEvent = await apiClient.createEvent({ name, training_flag: trainingFlag, auto_attach_divera: autoAttachDivera })
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

  const unarchiveEvent = useCallback(async (eventId: string) => {
    await apiClient.unarchiveEvent(eventId)
    await refreshEvents()
  }, [refreshEvents])

  const deleteEvent = useCallback(async (eventId: string) => {
    await apiClient.deleteEvent(eventId)
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(null)
    }
    await refreshEvents()
  }, [selectedEvent, setSelectedEvent, refreshEvents])

  // Load events on mount (only when authenticated)
  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      setIsLoading(false)
      return
    }

    refreshEvents()
  }, [authLoading, isAuthenticated, refreshEvents])

  return (
    <EventContext.Provider
      value={{
        selectedEvent,
        setSelectedEvent,
        events,
        isLoading,
        isEventLoaded,
        error,
        refreshEvents,
        createEvent,
        archiveEvent,
        unarchiveEvent,
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

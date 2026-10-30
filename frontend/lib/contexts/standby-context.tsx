'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { apiClient } from '@/lib/api-client'
import type { ApiStandby } from '@/lib/api/types'
import { AuthContext, useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { useDeployment } from '@/lib/hooks/use-deployment'
import { wsClient } from '@/lib/websocket-client'

/**
 * The standby box (`DEPLOYMENT_ROLE=standby`, backend `app/standby.py`): a live mirror of the
 * hosted board, look-only until somebody takes one Ereignis offline.
 *
 * `StandbyProvider` sits inside the event context and does two things:
 * - it keeps the mirror's state (`useStandby`) for the band (`components/standby-band.tsx`):
 *   how current it is and which Ereignisse were taken offline;
 * - it re-provides the auth context with `isEditor`/`isAdmin` off while the open Ereignis is
 *   only mirrored, so every control that already hides for a viewer hides here too. The real
 *   role stays in `canTakeOver` – the takeover is the one action a mirror offers.
 *
 * On every other deployment it renders its children untouched and asks nothing after the
 * first `/api/deployment`.
 */

interface StandbyState {
  /** This box mirrors a hosted board. False everywhere else. */
  mirror: boolean
  /** The hosted board was heard from recently. */
  current: boolean
  /** When it was last heard from – the band's «Stand». */
  lastReceivedAt: Date | null
  /** Ereignis id → when it was taken offline here. */
  detached: Map<string, Date>
  /** The open Ereignis was taken offline: it is worked on here. */
  selectedDetached: boolean
  /** Editors and admins may take an Ereignis offline (the role before the gate). */
  canTakeOver: boolean
  /** Take an Ereignis offline. Throws on failure; the caller says so. */
  takeOver: (eventId: string) => Promise<void>
}

const OFF: StandbyState = {
  mirror: false,
  current: false,
  lastReceivedAt: null,
  detached: new Map(),
  selectedDetached: false,
  canTakeOver: false,
  takeOver: async () => {},
}

const StandbyContext = createContext<StandbyState>(OFF)

// The band's «Stand» has to move while nothing else happens, and a takeover on another
// device has to reach this one even without a socket.
const POLL_MS = 15_000

function toState(raw: ApiStandby | null): Pick<StandbyState, 'mirror' | 'current' | 'lastReceivedAt' | 'detached'> {
  if (!raw?.mirror) return OFF
  return {
    mirror: true,
    current: raw.current ?? false,
    lastReceivedAt: raw.last_received_at ? new Date(raw.last_received_at) : null,
    detached: new Map((raw.detached ?? []).map((d) => [d.event_id, new Date(d.detached_at)])),
  }
}

export function StandbyProvider({ children }: { children: React.ReactNode }) {
  const deployment = useDeployment()
  const auth = useAuth()
  const { selectedEvent } = useEvent()
  const isStandby = deployment.role === 'standby'
  const [raw, setRaw] = useState<ApiStandby | null>(null)

  const refresh = useCallback(async () => {
    const next = await apiClient.getStandby()
    if (next) setRaw(next)
  }, [])

  useEffect(() => {
    if (!isStandby) return
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    // The backend pushes these when the mirror applied something, and after a takeover.
    const off = wsClient.on('incident_update', () => void refresh())
    return () => {
      window.clearInterval(id)
      off()
    }
  }, [isStandby, refresh])

  // A just-created Ereignis is offline from its first row; ask again when another one opens.
  const selectedId = selectedEvent?.id
  useEffect(() => {
    if (isStandby && selectedId) void refresh()
  }, [isStandby, selectedId, refresh])

  const takeOver = useCallback(async (eventId: string) => {
    setRaw(await apiClient.takeOverEvent(eventId))
  }, [])

  const state = useMemo<StandbyState>(() => {
    if (!isStandby) return OFF
    const base = toState(raw)
    return {
      ...base,
      // Until the first answer, a standby box is treated as a mirror: look-only, never editable.
      mirror: true,
      selectedDetached: !!selectedEvent && base.detached.has(selectedEvent.id),
      canTakeOver: auth.isEditor,
      takeOver,
    }
  }, [isStandby, raw, selectedEvent, auth.isEditor, takeOver])

  const gated = useMemo(
    () => (state.mirror && !state.selectedDetached ? { ...auth, isEditor: false, isAdmin: false } : auth),
    [auth, state.mirror, state.selectedDetached],
  )

  return (
    <StandbyContext.Provider value={state}>
      <AuthContext.Provider value={gated}>{children}</AuthContext.Provider>
    </StandbyContext.Provider>
  )
}

export function useStandby(): StandbyState {
  return useContext(StandbyContext)
}

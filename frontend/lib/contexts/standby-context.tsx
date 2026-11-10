'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { apiClient } from '@/lib/api-client'
import type { ApiStandby, ApiStandbyLead } from '@/lib/api/types'
import { AuthContext, useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { useDeployment } from '@/lib/hooks/use-deployment'
import { usePolling } from '@/lib/hooks/use-polling'
import { wsClient } from '@/lib/websocket-client'

/**
 * The standby box and the hosted board leading Ereignisse in turn (backend `app/standby.py`,
 * `app/standby_sync.py`): exactly one of them leads an Ereignis, the other shows it look-only.
 *
 * `StandbyProvider` sits inside the event context and does two things:
 * - it keeps who leads what (`useStandby`) for the band (`components/standby-band.tsx`);
 * - it re-provides the auth context with `isEditor`/`isAdmin` off while the open Ereignis is led
 *   on the OTHER system, so every control that already hides for a viewer hides here too. The
 *   real role stays in `canTakeOver`, and on the hosted board in `canAddNew`: there, new things
 *   (an Einsatz, a Tagebuch line) may still be added to an Ereignis the box leads.
 *
 * On the box everything is look-only until it leads the open Ereignis. On the hosted board it
 * asks `/api/standby` now and then and changes nothing unless a box leads the open Ereignis.
 */

export type StandbyLead = Omit<ApiStandbyLead, 'since' | 'contact_at'> & { since: Date; contactAt: Date | null }

interface StandbyState {
  /** This box mirrors a hosted board. False everywhere else. */
  mirror: boolean
  /** The hosted board was heard from recently (box only). */
  current: boolean
  /** When the hosted board was last heard from – the mirror band's «Stand» (box only). */
  lastReceivedAt: Date | null
  /** Ereignis id → who leads it, for every Ereignis a box took over at some point. */
  leads: Map<string, StandbyLead>
  /** The lead of the open Ereignis, if a box was ever involved. */
  selectedLead: StandbyLead | null
  /** The open Ereignis is led on this system (on the hosted board: by default). */
  selectedLedHere: boolean
  /** Editors and admins may take an Ereignis over (the role before the gate). */
  canTakeOver: boolean
  /** May still add new things while the other system leads (hosted board only). */
  canAddNew: boolean
  /** «Dieses Ereignis offline übernehmen» (box) / «Hier übernehmen» (hosted). Throws on failure. */
  takeOver: (eventId: string) => Promise<void>
  /** Ask again now – after a conflict was decided, say. */
  refresh: () => Promise<void>
}

// Outside a provider (tests, isolated pages): a board that leads everything itself.
const StandbyContext = createContext<StandbyState>({
  mirror: false,
  current: false,
  lastReceivedAt: null,
  leads: new Map(),
  selectedLead: null,
  selectedLedHere: true,
  canTakeOver: false,
  canAddNew: false,
  takeOver: async () => {},
  refresh: async () => {},
})

// The band's «Stand» has to move while nothing else happens, and a takeover on another
// device or system has to reach this one even without a socket.
const POLL_MS = 15_000

function toLeads(raw: ApiStandby | null): Map<string, StandbyLead> {
  return new Map(
    (raw?.leads ?? []).map(({ since, contact_at, ...rest }) => [
      rest.event_id,
      { ...rest, since: new Date(since), contactAt: contact_at ? new Date(contact_at) : null },
    ]),
  )
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

  // The shared loop: pauses in a hidden tab and asks again the moment it shows.
  usePolling(refresh, { intervalMs: POLL_MS })
  // Pushed when the mirror or the sync wrote something, and after every takeover.
  useEffect(() => wsClient.on('incident_update', () => void refresh()), [refresh])

  // A just-created Ereignis on the box is led there from its first row; ask again on a switch.
  const selectedId = selectedEvent?.id
  useEffect(() => {
    if (selectedId) void refresh()
  }, [selectedId, refresh])

  const takeOver = useCallback(
    async (eventId: string) => {
      setRaw(await (isStandby ? apiClient.takeOverEvent(eventId) : apiClient.takeBackEvent(eventId)))
    },
    [isStandby],
  )

  const state = useMemo<StandbyState>(() => {
    const leads = toLeads(raw)
    const selectedLead = (selectedEvent && leads.get(selectedEvent.id)) || null
    const here = isStandby ? 'standby' : 'hosted'
    // On the box an Ereignis is led here only by an explicit takeover; until the first answer
    // the box is a mirror – look-only, never editable. On the hosted board, by default.
    const selectedLedHere = selectedLead ? selectedLead.holder === here : !isStandby
    return {
      mirror: isStandby,
      current: raw?.current ?? false,
      lastReceivedAt: raw?.last_received_at ? new Date(raw.last_received_at) : null,
      leads,
      selectedLead,
      selectedLedHere,
      canTakeOver: auth.isEditor,
      canAddNew: !isStandby && !selectedLedHere && auth.isEditor,
      takeOver,
      refresh,
    }
  }, [isStandby, raw, selectedEvent, auth.isEditor, takeOver, refresh])

  const gated = useMemo(
    () => (state.selectedLedHere ? auth : { ...auth, isEditor: false, isAdmin: false }),
    [auth, state.selectedLedHere],
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

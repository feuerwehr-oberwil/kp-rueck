import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/**
 * The GPS prompts only exist to ask the KP for a write («freigeben?», «auf Einsatz setzen?»).
 * The phone board is read-only (owner, 14.11.2026), so on a phone they never open – the bell
 * notification says what happened. On the desk they open as before.
 */

const handlers = vi.hoisted(() => new Map<string, (payload: Record<string, string>) => unknown>())
const phone = vi.hoisted(() => ({ current: false }))

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ isEditor: true }) }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => phone.current }))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: {
    on: (event: string, handler: (payload: Record<string, string>) => unknown) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
  },
}))
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getIncident: vi.fn().mockResolvedValue({ status: 'enroute', location_address: 'Hauptstrasse 1', title: '' }),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const board = vi.hoisted(() => ({ operations: [] as unknown[], personnel: [] as unknown[] }))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => board }))
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ groups: [] }) }))

import { GpsArrivalPrompt } from '@/components/gps-arrival-prompt'
import { GpsReleasePrompt } from '@/components/gps-release-prompt'

afterEach(() => {
  cleanup()
  handlers.clear()
  phone.current = false
  board.operations = []
})

const PROMPTS = [
  ['GpsReleasePrompt', GpsReleasePrompt, 'gps_release_prompt'],
  ['GpsArrivalPrompt', GpsArrivalPrompt, 'gps_arrival_prompt'],
] as const

describe.each(PROMPTS)('%s', (_name, Prompt, event) => {
  const broadcast = async () => {
    await act(async () => {
      await handlers.get(event)?.({ assignment_id: 'a1', incident_id: 'i1', vehicle_name: 'TLF' })
    })
  }

  it('asks on the desk', async () => {
    renderWithIntl(<Prompt />)
    await broadcast()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('never opens on a phone', async () => {
    phone.current = true
    renderWithIntl(<Prompt />)
    expect(handlers.has(event)).toBe(false)
    await broadcast()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

// Owner pick #21: «Nur TLF freigeben» is the main answer unless TLF is all that is left.
describe('GpsReleasePrompt main answer', () => {
  const broadcast = async () => {
    await act(async () => {
      await handlers.get('gps_release_prompt')?.({ assignment_id: 'a1', incident_id: 'i1', vehicle_id: 'v-tlf', vehicle_name: 'TLF' })
    })
  }
  const tlf = { vehicleId: 'v-tlf', assignmentId: 'a1', name: 'TLF', callsign: null }

  it('is «Nur TLF freigeben» while a crew is still on the Einsatz', async () => {
    board.operations = [{ id: 'i1', vehicles: [tlf], crew: [{ personnelId: 'p-1', assignmentId: 'c1', name: 'Meier' }], materials: [] }]
    renderWithIntl(<GpsReleasePrompt />)
    await broadcast()
    expect(screen.getByRole('button', { name: 'Nur TLF freigeben' })).toHaveFocus()
  })

  it('is «Einsatz abschliessen» when TLF is the last resource', async () => {
    board.operations = [{ id: 'i1', vehicles: [tlf], crew: [], materials: [] }]
    renderWithIntl(<GpsReleasePrompt />)
    await broadcast()
    expect(screen.getByRole('button', { name: 'Einsatz abschliessen' })).toHaveFocus()
  })
})

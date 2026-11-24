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
const selected = vi.hoisted(() => ({ eventId: 'e1', setSelectedEvent: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ isEditor: true }) }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => phone.current }))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({ selectedEvent: { id: selected.eventId }, setSelectedEvent: selected.setSelectedEvent }),
  apiEventToEvent: (event: { id: string }) => ({ converted: event.id }),
}))
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
    getIncident: vi.fn().mockResolvedValue({ status: 'enroute', event_id: 'e1', location_address: 'Hauptstrasse 1', title: '' }),
    getEvent: vi.fn().mockResolvedValue({ id: 'e1' }),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { GpsArrivalPrompt } from '@/components/gps-arrival-prompt'
import { GpsReleasePrompt } from '@/components/gps-release-prompt'
import { onCompletionRequest } from '@/lib/hooks/use-completion-request'

afterEach(() => {
  cleanup()
  handlers.clear()
  phone.current = false
  selected.eventId = 'e1'
  selected.setSelectedEvent.mockClear()
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

// Owner feedback 23.11.2026 #13: «Einsatz abschliessen» is always the main answer, and it
// hands over to the board's close flow (which asks about the material).
describe('GpsReleasePrompt main answer', () => {
  const open = async () => {
    renderWithIntl(<GpsReleasePrompt />)
    await act(async () => {
      await handlers.get('gps_release_prompt')?.({ assignment_id: 'a1', incident_id: 'i1', vehicle_name: 'TLF' })
    })
    return screen.getByRole('button', { name: 'Einsatz abschliessen' })
  }

  it('is «Einsatz abschliessen», which hands the Einsatz to the board\'s close flow', async () => {
    const asked = vi.fn(() => true)
    const stop = onCompletionRequest(asked)
    const main = await open()
    expect(main).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Nur TLF freigeben' })).toBeInTheDocument()

    await act(async () => main.click())

    expect(asked).toHaveBeenCalledWith({ incidentId: 'i1', eventId: 'e1' })
    expect(selected.setSelectedEvent).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    stop()
  })

  // Review B: with another Ereignis open, Enter used to dismiss the prompt and close nothing.
  it('switches to the Einsatz\'s Ereignis first when another one is open', async () => {
    selected.eventId = 'e2'
    const asked = vi.fn(() => true)
    const stop = onCompletionRequest(asked)
    const main = await open()

    await act(async () => main.click())

    expect(selected.setSelectedEvent).toHaveBeenCalledWith({ converted: 'e1' })
    expect(asked).toHaveBeenCalledWith({ incidentId: 'i1', eventId: 'e1' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    stop()
  })

  it('stays open when no board takes the request', async () => {
    const stop = onCompletionRequest(() => false)
    const main = await open()

    await act(async () => main.click())

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    stop()
  })
})

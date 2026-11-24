import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, screen } from '@testing-library/react'
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
import { type CompletionBoard, useCompletionBoard } from '@/lib/hooks/use-completion-request'

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

// Owner feedback 23.11.2026 #13: «Einsatz abschliessen» is the main answer once the board on
// screen has the Einsatz, and it hands over to the board's close flow (which asks about the
// material). Sol review B round 2: nothing is queued across an Ereignis switch.
describe('GpsReleasePrompt main answer', () => {
  const run = vi.fn()
  const retry = vi.fn().mockResolvedValue(undefined)
  afterEach(() => {
    run.mockClear()
    retry.mockClear()
  })

  type Offered = { eventId: string; loaded: boolean; ids: string[]; failed?: boolean }
  const offerBoard = (initialProps: Offered) => {
    const board = (props: Offered): CompletionBoard => ({
      eventId: props.eventId,
      loaded: props.loaded,
      failed: props.failed ?? false,
      has: (incidentId) => props.ids.includes(incidentId),
      run,
      retry,
    })
    const hook = renderHook((props) => useCompletionBoard(board(props)), { initialProps })
    return (next: Offered) => act(() => hook.rerender(next))
  }
  const offer = (eventId: string, loaded: boolean, ...ids: string[]) => {
    const rerender = offerBoard({ eventId, loaded, ids })
    return (next: string, nextLoaded: boolean, ...nextIds: string[]) =>
      rerender({ eventId: next, loaded: nextLoaded, ids: nextIds })
  }

  const open = async () => {
    renderWithIntl(<GpsReleasePrompt />)
    await act(async () => {
      await handlers.get('gps_release_prompt')?.({ assignment_id: 'a1', incident_id: 'i1', vehicle_name: 'TLF' })
    })
  }

  it('is «Einsatz abschliessen» when the board has the Einsatz, and runs its close flow', async () => {
    offer('e1', true, 'i1')
    await open()
    const main = screen.getByRole('button', { name: 'Einsatz abschliessen' })
    expect(main).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Nur TLF freigeben' })).toBeInTheDocument()

    await act(async () => main.click())

    expect(run).toHaveBeenCalledWith('i1')
    expect(selected.setSelectedEvent).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  // Review B round 2: the queued close ran before the Auftrag loaded and dismissed the prompt.
  it('offers «Ereignis öffnen» for another Ereignis and stays open until that board has the Einsatz', async () => {
    selected.eventId = 'e2'
    const board = offer('e2', true)
    await open()

    await act(async () => screen.getByRole('button', { name: 'Ereignis öffnen' }).click())
    expect(selected.setSelectedEvent).toHaveBeenCalledWith({ converted: 'e1' })
    expect(run).not.toHaveBeenCalled()

    board('e1', false)
    expect(screen.getByRole('button', { name: 'Einsatz abschliessen' })).toBeDisabled()

    board('e1', true, 'i1')
    const main = screen.getByRole('button', { name: 'Einsatz abschliessen' })
    expect(main).toBeEnabled()
    expect(main).toHaveFocus()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await act(async () => main.click())
    expect(run).toHaveBeenCalledWith('i1')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('says so when the loaded board has not the Einsatz, and stays open', async () => {
    offer('e1', true)
    await open()

    expect(screen.getByRole('status')).toHaveTextContent('Einsatz nicht gefunden – im Board öffnen')
    expect(screen.getByRole('button', { name: 'Einsatz abschliessen' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Nur TLF freigeben' })).toBeEnabled()
    expect(run).not.toHaveBeenCalled()
  })

  // Sol review B round 3: a failed load read as «Einsatz nicht gefunden», with no way back.
  it('says the load failed and retries it, then offers the close', async () => {
    const board = offerBoard({ eventId: 'e1', loaded: true, ids: [], failed: true })
    await open()

    expect(screen.getByRole('status')).toHaveTextContent('Laden fehlgeschlagen – erneut versuchen')
    await act(async () => screen.getByRole('button', { name: 'Erneut laden' }).click())
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    board({ eventId: 'e1', loaded: true, ids: ['i1'] })
    const main = screen.getByRole('button', { name: 'Einsatz abschliessen' })
    expect(main).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
    await act(async () => main.click())
    expect(run).toHaveBeenCalledWith('i1')
  })
})

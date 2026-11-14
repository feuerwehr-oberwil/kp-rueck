import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Event } from '@/lib/types/incidents'

const ctx = vi.hoisted(() => ({ events: [] as Event[], setSelectedEvent: vi.fn() }))
const push = vi.hoisted(() => vi.fn())

const phone = vi.hoisted(() => ({ current: false }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => phone.current }))
// The admin's «Station einrichten» strip has its own test; here it would need auth and the API.
vi.mock('@/components/station-setup-strip', () => ({ StationSetupStrip: () => null }))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({ events: ctx.events, isLoading: false, setSelectedEvent: ctx.setSelectedEvent }),
}))

import { EventSelectionEmptyState } from './event-selection-empty-state'

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000)
function ev(name: string, openedHoursAgo: number, activeHoursAgo: number): Event {
  return {
    id: name,
    name,
    training_flag: false,
    created_at: ago(openedHoursAgo),
    updated_at: ago(activeHoursAgo),
    archived_at: null,
    last_activity_at: ago(activeHoursAgo),
    incident_count: 3,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  phone.current = false
})

describe('EventSelectionEmptyState', () => {
  it('lists the recent open Ereignisse; the most recently active one is the ink «Öffnen» and ↵ opens it', () => {
    const sturm = ev('Unwetter Oberwil', 5, 0.2)
    ctx.events = [ev('Übung Nacht', 2, 1), sturm]
    renderWithIntl(<EventSelectionEmptyState />)

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Unwetter Oberwil'),
      expect.stringContaining('Übung Nacht'),
    ])
    expect(screen.getByRole('button', { name: 'Unwetter Oberwil: Öffnen' })).toHaveAttribute('aria-keyshortcuts', 'Enter')

    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(ctx.setSelectedEvent).toHaveBeenCalledWith(sturm)
    expect(push).toHaveBeenCalledWith('/')
  })

  it('falls back to the plain card when nothing was opened in the last 24 h', () => {
    ctx.events = [ev('Alt', 30, 1)]
    renderWithIntl(<EventSelectionEmptyState />)

    expect(screen.getByRole('heading', { name: 'Ereignis wählen' })).toBeInTheDocument()
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.queryByText(/Kein Problem/)).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(ctx.setSelectedEvent).not.toHaveBeenCalled()
  })
})

describe('EventSelectionEmptyState on the phone – it switches, the desk opens a new one', () => {
  it('makes «Ereignisse anzeigen» the main action and says where a new one is opened', () => {
    phone.current = true
    ctx.events = [ev('Alt', 30, 1)]
    renderWithIntl(<EventSelectionEmptyState />)
    expect(screen.queryByRole('button', { name: /Neues Ereignis/ })).toBeNull()
    expect(screen.getByText(/ein neues wird am Desktop eröffnet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ereignisse anzeigen/ }))
    expect(push).toHaveBeenCalledWith('/events')
  })

  it('still lists the recent Ereignisse to open, without «Neues Ereignis»', () => {
    phone.current = true
    ctx.events = [ev('Unwetter Oberwil', 5, 0.2)]
    renderWithIntl(<EventSelectionEmptyState />)
    expect(screen.getByRole('button', { name: 'Unwetter Oberwil: Öffnen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Neues Ereignis/ })).toBeNull()
  })
})

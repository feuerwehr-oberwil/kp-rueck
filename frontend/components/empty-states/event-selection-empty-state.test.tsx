import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Event } from '@/lib/types/incidents'

const ctx = vi.hoisted(() => ({ events: [] as Event[], setSelectedEvent: vi.fn() }))
const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
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

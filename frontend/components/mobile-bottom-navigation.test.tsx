/**
 * The «Mehr» sheet's «Schnellzugriff» section exists only when it has an entry.
 *
 * Its entries are the board's sheets (passed in as callbacks) plus the Übungs-Steuerung of a
 * training Ereignis. The Lagekarte and the settings/help pages pass no callbacks, so outside an
 * Übung the heading used to stand alone over nothing (owner, 03.10.2026).
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { MobileBottomNavigation } from './mobile-bottom-navigation'

const auth = vi.hoisted(() => ({ current: { isEditor: true, logout: vi.fn(), user: { role: 'editor' } } }))
const event = vi.hoisted(() => ({ current: { training_flag: false } }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth.current }))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({
    selectedEvent: { id: 'e1', name: 'Sturm Ost', archived_at: null, last_activity_at: new Date(), ...event.current },
    events: [],
    setSelectedEvent: vi.fn(),
  }),
}))
vi.mock('@/components/viewport-insets', () => ({ useNavReserve: () => {} }))
vi.mock('@/components/auth/role-badge', () => ({ RoleBadge: () => null }))

async function openSheet() {
  await userEvent.click(screen.getByRole('button', { name: 'Mehr Optionen' }))
}

describe('MobileBottomNavigation «Schnellzugriff»', () => {
  beforeEach(() => {
    auth.current = { isEditor: true, logout: vi.fn(), user: { role: 'editor' } }
    event.current = { training_flag: false }
  })

  it('is absent where the page offers no quick action (Lagekarte, Einstellungen)', async () => {
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await openSheet()
    expect(screen.queryByText('Schnellzugriff')).toBeNull()
    // the sections that do have entries are still there
    expect(screen.getByText('Verwaltung')).toBeDefined()
  })

  it('shows the board’s sheets on the board', async () => {
    renderWithIntl(<MobileBottomNavigation currentPage="kanban" onLinks={vi.fn()} onPersonnel={vi.fn()} />)
    await openSheet()
    expect(screen.getByText('Schnellzugriff')).toBeDefined()
    expect(screen.getByText('Links & QR')).toBeDefined()
    expect(screen.getByText('Personal')).toBeDefined()
  })

  it('shows the Übungs-Steuerung of a training Ereignis on any page', async () => {
    event.current = { training_flag: true }
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await openSheet()
    expect(screen.getByText('Schnellzugriff')).toBeDefined()
    expect(screen.getByText('Übungs-Steuerung')).toBeDefined()
  })

  it('is absent for a viewer even on the board (the sheets are editor-only)', async () => {
    auth.current = { isEditor: false, logout: vi.fn(), user: { role: 'viewer' } }
    renderWithIntl(<MobileBottomNavigation currentPage="kanban" onLinks={vi.fn()} />)
    await openSheet()
    expect(screen.queryByText('Schnellzugriff')).toBeNull()
  })
})

describe('MobileBottomNavigation tap animation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves no timer behind when the bar unmounts mid-animation', async () => {
    vi.useFakeTimers()
    const { unmount } = renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    // A plain click: userEvent would wait on the faked clock.
    screen.getByRole('button', { name: 'Mehr Optionen' }).click()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    // The 200 ms reset used to outlive the bar and fire after jsdom was gone (CI flake).
    expect(vi.getTimerCount()).toBe(0)
  })
})

/**
 * The «Mehr» sheet's «Schnellzugriff»: the same entries on every page (owner, 16.11.2026 – on the
 * Lagekarte it used to offer only Kennzahlen, because the sheets were the board's), editing ones
 * for editors only, and the section only when it has an entry (owner, 03.10.2026).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { MobileBottomNavigation } from './mobile-bottom-navigation'

const auth = vi.hoisted(() => ({ current: { isEditor: true, logout: vi.fn(), user: { role: 'editor' } } }))
const event = vi.hoisted(() => ({ current: { training_flag: false } as { training_flag: boolean } | null }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth.current }))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({
    selectedEvent: event.current && { id: 'e1', name: 'Sturm Ost', archived_at: null, last_activity_at: new Date(), ...event.current },
    events: [],
    setSelectedEvent: vi.fn(),
  }),
}))
vi.mock('@/components/viewport-insets', () => ({ useNavReserve: () => {} }))
vi.mock('@/components/auth/role-badge', () => ({ RoleBadge: () => null }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => true }))
// The sheets themselves are their own components; here only which one the nav opens.
vi.mock('@/components/mobile/phone-quick-sheets', () => ({
  PhoneQuickSheets: ({ open }: { open: string | null }) => <output data-testid="quick-sheet">{open ?? ''}</output>,
}))

const EDITOR_ENTRIES = ['Links & QR', 'Verlauf', 'Kennzahlen', 'Personal', 'Fahrzeuge', 'Drucken']

async function openSheet() {
  await userEvent.click(screen.getByRole('button', { name: 'Mehr Optionen' }))
}

describe('MobileBottomNavigation «Schnellzugriff»', () => {
  beforeEach(() => {
    auth.current = { isEditor: true, logout: vi.fn(), user: { role: 'editor' } }
    event.current = { training_flag: false }
  })

  it.each(['kanban', 'map', 'settings'])('offers an editor every sheet on %s', async (page) => {
    renderWithIntl(<MobileBottomNavigation currentPage={page} />)
    await openSheet()
    for (const entry of EDITOR_ENTRIES) expect(screen.getByRole('button', { name: entry })).toBeDefined()
  })

  it('opens the sheet over the page it is on', async () => {
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await openSheet()
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeuge' }))
    expect(await screen.findByText('vehicles')).toBeDefined()
  })

  it('offers a viewer only what a viewer may read', async () => {
    auth.current = { isEditor: false, logout: vi.fn(), user: { role: 'viewer' } }
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await openSheet()
    expect(screen.getByRole('button', { name: 'Verlauf' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Kennzahlen' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Links & QR' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Personal' })).toBeNull()
  })

  it('is absent without an Ereignis – every entry is about the open one', async () => {
    event.current = null
    renderWithIntl(<MobileBottomNavigation currentPage="events" />)
    await openSheet()
    expect(screen.queryByText('Schnellzugriff')).toBeNull()
    expect(screen.getByText('Verwaltung')).toBeDefined()
  })

  it('shows the Übungs-Steuerung of a training Ereignis', async () => {
    event.current = { training_flag: true }
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await openSheet()
    expect(screen.getByText('Übungs-Steuerung')).toBeDefined()
  })
})

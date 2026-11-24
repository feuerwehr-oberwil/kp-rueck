/**
 * The «Mehr» sheet's «Schnellzugriff»: the same entries on every page (owner, 16.11.2026 – on the
 * Lagekarte it used to offer only Kennzahlen, because the sheets were the board's), editing ones
 * for editors only, and the section only when it has an entry (owner, 03.10.2026). The five tiles
 * of the phone frame (owner picks 1A + 2A, 24.11.2026): Personal and Meldungen open sheets, the
 * Ereignis, the account, Einstellungen and Hilfe left «Mehr» for the pill (owner, sign-off).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { MobileBottomNavigation } from './mobile-bottom-navigation'

type Auth = { isEditor: boolean; isViewer?: boolean; isAuthenticated?: boolean; logout: () => void; user: { role: string } }
const auth = vi.hoisted(() => ({ current: { isEditor: true, isAuthenticated: true, logout: vi.fn(), user: { role: 'editor' } } as Auth }))
const event = vi.hoisted(() => ({ current: { training_flag: false } as { training_flag: boolean } | null }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
// A tab's <Link> must not navigate jsdom; the tap's own answer is what is under test.
vi.mock('next/link', () => ({
  default: ({ href, onClick, onNavigate, children, ...rest }: React.ComponentProps<'a'> & { href: string; onNavigate?: () => void }) => (
    <a href={href} {...rest} onClick={(e) => { e.preventDefault(); onClick?.(e); onNavigate?.() }}>{children}</a>
  ),
}))
const loading = vi.hoisted(() => ({ startRoute: vi.fn(), cancelRoute: vi.fn() }))
vi.mock('@/components/ui/top-loading-bar', () => ({ topLoading: loading }))
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
// What the Meldungen tile counts: the bell's open entries, the Alarmeingang's new alarms.
const meldungen = vi.hoisted(() => ({ bell: 0, alarms: 0 }))
vi.mock('@/components/notifications/phone-notification-sheet', () => ({
  PhoneNotificationSheet: ({ open }: { open: boolean }) => (open ? <output data-testid="meldungen-sheet" /> : null),
}))
vi.mock('@/lib/contexts/notification-context', () => ({ useNotifications: () => ({ notifications: [] }) }))
vi.mock('@/lib/hooks/use-field-requests', () => ({
  useOpenFieldRequests: () => ({}),
  useBellCount: () => ({ count: meldungen.bell }),
}))
vi.mock('@/components/alarm-inbox/alarm-inbox-button', () => ({ useNewAlarmCount: () => meldungen.alarms }))

const EDITOR_ENTRIES = ['Links & QR', 'Verlauf', 'Kennzahlen', 'Fahrzeuge', 'Drucken']

async function openSheet() {
  await userEvent.click(screen.getByRole('button', { name: 'Mehr Optionen' }))
}

describe('MobileBottomNavigation «Schnellzugriff»', () => {
  beforeEach(() => {
    auth.current = { isEditor: true, isAuthenticated: true, logout: vi.fn(), user: { role: 'editor' } }
    event.current = { training_flag: false }
  })

  it.each(['kanban', 'map', 'settings'] as const)('offers an editor every sheet on %s', async (page) => {
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
    auth.current = { isEditor: false, isViewer: true, isAuthenticated: true, logout: vi.fn(), user: { role: 'viewer' } }
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await openSheet()
    expect(screen.getByRole('button', { name: 'Verlauf' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Kennzahlen' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Links & QR' })).toBeNull()
  })

  // Owner pick 2A + sign-off 24.11.2026: the Ereignis, the account, Einstellungen and Hilfe
  // are the pill's (PhoneEventPill), «Mehr» the tools'.
  it('holds no Ereignis switch, no account, no Einstellungen and no Hilfe', async () => {
    renderWithIntl(<MobileBottomNavigation currentPage="kanban" />)
    await openSheet()
    for (const entry of ['Alle Ereignisse', 'Abmelden', 'Einstellungen', 'Hilfe', 'Verwaltung', 'Support']) {
      expect(screen.queryByText(entry)).toBeNull()
    }
  })

  it('is off without an Ereignis – every entry is about the open one', () => {
    event.current = null
    renderWithIntl(<MobileBottomNavigation currentPage="events" />)
    expect(screen.getByRole('button', { name: 'Mehr Optionen' })).toBeDisabled()
  })

  it('shows the Übungs-Steuerung of a training Ereignis', async () => {
    event.current = { training_flag: true }
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await openSheet()
    expect(screen.getByText('Übungs-Steuerung')).toBeDefined()
  })
})

describe('MobileBottomNavigation tabs', () => {
  beforeEach(() => {
    auth.current = { isEditor: true, isAuthenticated: true, logout: vi.fn(), user: { role: 'editor' } }
    event.current = { training_flag: false }
    meldungen.bell = 0
    meldungen.alarms = 0
  })

  // Phone sweep 24.11.2026 #24: «Übungs-Steuerung» lit no tab at all.
  it('lights «Mehr» on the Übungs-Steuerung', () => {
    renderWithIntl(<MobileBottomNavigation currentPage="training" />)
    expect(screen.getByRole('button', { name: 'Mehr Optionen' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Einsätze' })).not.toHaveAttribute('aria-current')
  })

  // The pill's pages (it marks them in its menu): no tile claims them.
  it.each(['events', 'settings', 'help'] as const)('lights no tile on %s', (page) => {
    renderWithIntl(<MobileBottomNavigation currentPage={page} />)
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(0)
    for (const tile of [...screen.getAllByRole('link'), ...screen.getAllByRole('button')]) {
      expect(tile).not.toHaveClass('bg-foreground/[0.09]')
    }
  })

  it('opens the Personal sheet over the page from its tile, and only with an Ereignis', async () => {
    renderWithIntl(<MobileBottomNavigation currentPage="map" />)
    await userEvent.click(screen.getByRole('button', { name: 'Personal' }))
    expect(screen.getByTestId('quick-sheet')).toHaveTextContent('personnel')
  })

  it('keeps Personal shut without an Ereignis', () => {
    event.current = null
    renderWithIntl(<MobileBottomNavigation currentPage="events" />)
    expect(screen.getByRole('button', { name: 'Personal' })).toBeDisabled()
  })

  it('counts the bell and the new alarms on the Meldungen tile and opens the list', async () => {
    meldungen.bell = 3
    meldungen.alarms = 9
    renderWithIntl(<MobileBottomNavigation currentPage="kanban" />)
    const tile = screen.getByRole('button', { name: 'Meldungen – 12 offen' })
    expect(screen.getByTestId('meldungen-badge')).toHaveTextContent('9+')
    await userEvent.click(tile)
    expect(screen.getByTestId('meldungen-sheet')).toBeDefined()
  })

  // The Alarmeingang refuses viewers: its alarms are no count of theirs.
  it('counts no alarms for a viewer', () => {
    auth.current = { isEditor: false, isViewer: true, isAuthenticated: true, logout: vi.fn(), user: { role: 'viewer' } }
    meldungen.bell = 1
    meldungen.alarms = 4
    renderWithIntl(<MobileBottomNavigation currentPage="help" />)
    expect(screen.getByRole('button', { name: 'Meldungen – 1 offen' })).toBeDefined()
  })

  // /help is public: signed out there is nothing to count and nobody to tell.
  it('has no Meldungen tile signed out', () => {
    auth.current = { isEditor: false, isAuthenticated: false, logout: vi.fn(), user: { role: '' } }
    renderWithIntl(<MobileBottomNavigation currentPage="help" />)
    expect(screen.queryByRole('button', { name: /^Meldungen/ })).toBeNull()
  })

  // Phone sweep 24.11.2026 #2: the tint and the loading bar waited for the next page.
  it('moves the tint and starts the loading bar on the tap', async () => {
    loading.startRoute.mockClear()
    renderWithIntl(<MobileBottomNavigation currentPage="kanban" />)
    const map = screen.getByRole('link', { name: 'Lagekarte' })
    await userEvent.click(map)
    expect(map).toHaveClass('text-foreground')
    expect(screen.getByRole('link', { name: 'Einsätze' })).toHaveClass('text-muted-foreground')
    expect(loading.startRoute).toHaveBeenCalledOnce()
  })

  it('starts nothing on a tap on the tab it is on', async () => {
    loading.startRoute.mockClear()
    renderWithIntl(<MobileBottomNavigation currentPage="kanban" />)
    await userEvent.click(screen.getByRole('link', { name: 'Einsätze' }))
    expect(loading.startRoute).not.toHaveBeenCalled()
  })

  it('takes the tint and the bar back when the tap returns to its page before the next arrives', async () => {
    loading.cancelRoute.mockClear()
    renderWithIntl(<MobileBottomNavigation currentPage="kanban" />)
    await userEvent.click(screen.getByRole('link', { name: 'Lagekarte' }))
    await userEvent.click(screen.getByRole('link', { name: 'Einsätze' }))
    expect(screen.getByRole('link', { name: 'Einsätze' })).toHaveClass('text-foreground')
    expect(loading.cancelRoute).toHaveBeenCalledOnce()
  })
})

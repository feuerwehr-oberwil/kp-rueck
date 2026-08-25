/**
 * Archivieren und Löschen sind Einweg-Aktionen (X5).
 *
 * Löschen nimmt jeden Einsatz unter dem Ereignis mit und hat kein Undo — ein
 * zweiter Klick, solange der erste noch unterwegs ist, ist deshalb kein
 * kosmetisches Problem, sondern ein zweiter DELETE auf denselben Datensatz.
 * Gemessen vor dem Fix: ein Doppelklick auf den Bestätigen-Button feuerte
 * zwei Requests, weil der Dialog offen und der Button klickbar blieb.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Event } from '@/lib/types/incidents'

const archiveEvent = vi.hoisted(() => vi.fn())
const deleteEvent = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  // the page mounts useGlobalNavigation, which reads the path to know which
  // g-prefix key means «already here»
  usePathname: () => '/events',
}))

vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({
    events: EVENTS,
    selectedEvent: null,
    setSelectedEvent: vi.fn(),
    createEvent: vi.fn(),
    archiveEvent,
    unarchiveEvent: vi.fn(),
    deleteEvent,
  }),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getPrinterStatus: vi.fn().mockResolvedValue({ enabled: false }),
    // The row chips ask every active row the same question; empty answer here —
    // the chips are not what this test is about.
    getEventRestliste: vi.fn().mockResolvedValue({
      missing_rapport: [],
      material_on_site: [],
      open_pickups: [],
      incident_total: 0,
    }),
  },
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

// Chrome around the cards — this test is about the two confirmation dialogs.
vi.mock('@/components/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/events/event-restliste', () => ({ EventRestliste: () => null }))
// Desktop layout erzwingen (matchMedia gibt es in jsdom nicht).
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/components/page-navigation', () => ({ PageNavigation: () => null }))
vi.mock('@/components/mobile-bottom-navigation', () => ({ MobileBottomNavigation: () => null }))

import EventsPage from '@/app/events/page'

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-active',
    name: 'Sturm Ost',
    training_flag: false,
    created_at: new Date('2026-08-01T08:00:00Z'),
    updated_at: new Date('2026-08-01T08:00:00Z'),
    archived_at: null,
    last_activity_at: new Date('2026-08-01T09:00:00Z'),
    incident_count: 7,
    ...overrides,
  }
}

const EVENTS: Event[] = [
  event(),
  event({
    id: 'evt-archived',
    name: 'Hochwasser Alt',
    archived_at: new Date('2026-08-02T08:00:00Z'),
  }),
]

/** A call that never settles: the window in which the second click happens. */
function pending() {
  return new Promise<void>(() => {})
}

async function openDialog(name: 'Archivieren' | 'Löschen') {
  const user = userEvent.setup()
  renderWithIntl(<EventsPage />)
  // Löschen lives on archived rows, which sit behind the collapsed Archiv
  // disclosure; Archivieren on the active row. Both hide in the row's ⋯ menu.
  if (name === 'Löschen') {
    await user.click(screen.getByRole('button', { name: 'Archiv (1)' }))
  }
  const rowName = name === 'Löschen' ? 'Hochwasser Alt' : 'Sturm Ost'
  const card = screen
    .getAllByTestId('event-card')
    .find((c) => within(c).queryByText(rowName)) as HTMLElement
  await user.click(within(card).getByRole('button', { name: 'Aktionen' }))
  await user.click(await screen.findByRole('menuitem', { name }))
  return { user, dialog: await screen.findByRole('dialog') }
}

describe('Ereignisse — Archivieren/Löschen bestätigen', () => {
  beforeEach(() => {
    archiveEvent.mockReset()
    deleteEvent.mockReset()
  })

  // Jeder Test endet mit einem offenen Dialog — das ist der Punkt: der Vorgang
  // läuft noch. Radix' FocusScope stellt den Fokus aber erst in einem
  // `setTimeout` nach dem Unmount wieder her. Läuft der erst, wenn Vitest die
  // jsdom-Umgebung schon abgebaut hat, wirft das Dispatchen einen unhandled
  // error — der laut Vitest andere Tests verfälschen kann. Also hier bewusst
  // abhängen und dem Timer eine Runde geben, solange das DOM noch lebt.
  afterEach(async () => {
    cleanup()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('löscht einmal, auch bei einem Doppelklick auf «Dauerhaft löschen»', async () => {
    deleteEvent.mockReturnValue(pending())
    const { user, dialog } = await openDialog('Löschen')

    await user.dblClick(within(dialog).getByRole('button', { name: 'Dauerhaft löschen' }))

    expect(deleteEvent).toHaveBeenCalledTimes(1)
    expect(deleteEvent).toHaveBeenCalledWith('evt-archived')
  })

  it('archiviert einmal, auch bei einem Doppelklick auf «Archivieren»', async () => {
    archiveEvent.mockReturnValue(pending())
    const { user, dialog } = await openDialog('Archivieren')

    await user.dblClick(within(dialog).getByRole('button', { name: 'Archivieren' }))

    expect(archiveEvent).toHaveBeenCalledTimes(1)
    expect(archiveEvent).toHaveBeenCalledWith('evt-active')
  })

  it('sperrt beide Wege aus dem Löschdialog, solange der Request läuft', async () => {
    deleteEvent.mockReturnValue(pending())
    const { user, dialog } = await openDialog('Löschen')

    const confirm = within(dialog).getByRole('button', { name: 'Dauerhaft löschen' })
    await user.click(confirm)

    expect(confirm).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeDisabled()
    // Esc darf den laufenden Vorgang nicht aus dem Blickfeld nehmen.
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})

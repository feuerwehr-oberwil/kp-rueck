/**
 * The phone's Ereignis pill IS the menu (owner picks 1A + 2A, phone sweep 24.11.2026): the open
 * Ereignis, a switch in one more tap, the app's pages and the account with «Abmelden».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const setSelectedEvent = vi.hoisted(() => vi.fn())
const requestLogout = vi.hoisted(() => vi.fn())
const pathname = vi.hoisted(() => ({ current: '/' }))

const ev = (id: string, name: string, training_flag: boolean, incident_count: number, activity: string) => ({
  id,
  name,
  training_flag,
  incident_count,
  archived_at: null,
  created_at: new Date('2026-11-24T21:41:00'),
  updated_at: new Date(),
  last_activity_at: new Date(activity),
})
const current = ev('e1', 'Demo-Lage #c7b4', true, 18, '2026-11-24T22:00:00')
const others = [ev('e2', 'Sturm Ost', false, 12, '2026-11-24T20:00:00'), ev('e3', 'Probe Süd', true, 6, '2026-11-24T21:00:00')]

vi.mock('next/navigation', () => ({ usePathname: () => pathname.current, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { username: 'demo', display_name: 'Demo Bearbeiter', role: 'editor' } }),
}))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({ selectedEvent: current, events: [current, ...others], setSelectedEvent }),
}))
vi.mock('@/lib/hooks/use-logout', () => ({ useLogout: () => ({ requestLogout, logoutDialog: null }) }))
vi.mock('@/components/auth/role-badge', () => ({ RoleBadge: () => null }))

import { PhoneEventPill } from './phone-event-pill'

async function openMenu() {
  const user = userEvent.setup()
  renderWithIntl(<PhoneEventPill />)
  await user.click(screen.getByRole('button', { name: 'Ereignis Demo-Lage #c7b4 – Menü' }))
  return { user, menu: screen.getByRole('menu') }
}

describe('PhoneEventPill', () => {
  beforeEach(() => {
    pathname.current = '/'
    setSelectedEvent.mockClear()
    requestLogout.mockClear()
  })

  it('switches the Ereignis in two taps, the most recently active first', async () => {
    const { user } = await openMenu()
    const rows = screen.getAllByRole('menuitem').map((row) => row.textContent)
    expect(rows.slice(0, 2)).toEqual(['Probe SüdÜbung · 6', 'Sturm Ost12'])
    await user.click(screen.getByRole('menuitem', { name: /Sturm Ost/ }))
    expect(setSelectedEvent).toHaveBeenCalledWith(others[0])
  })

  it('holds the app’s pages and marks the one the operator is on', async () => {
    pathname.current = '/settings'
    await openMenu()
    expect(screen.getByRole('menuitem', { name: 'Alle Ereignisse' })).toHaveAttribute('href', '/events')
    expect(screen.getByRole('menuitem', { name: 'Hilfe' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('menuitem', { name: 'Einstellungen' })).toHaveAttribute('aria-current', 'page')
  })

  it('ends with who is signed in and «Abmelden», which asks first', async () => {
    const { user, menu } = await openMenu()
    expect(menu).toHaveTextContent('Demo Bearbeiter')
    await user.click(screen.getByRole('menuitem', { name: 'Abmelden' }))
    expect(requestLogout).toHaveBeenCalledOnce()
  })
})

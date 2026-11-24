import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/**
 * The door kiosk (sweep 2026-10-23, UX-PHONE-13): checking in stays one tap and
 * clears the search for the next person; checking out — what a brushing thumb
 * does — can be taken back from the toast.
 */

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ token: 'tok' }) }))
const api = vi.hoisted(() => ({
  getCheckInList: vi.fn(),
  checkInPersonnel: vi.fn(),
  checkOutPersonnel: vi.fn(),
  createPersonnel: vi.fn(),
  setAttendancePlan: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('@/lib/websocket-client', () => ({ wsClient: { getStatus: () => 'disconnected', connect: vi.fn(), disconnect: vi.fn(), on: () => () => {} } }))
const auth = vi.hoisted(() => ({ isEditor: false }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth }))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import CheckInPage from '@/app/check-in/page'

function roster() {
  api.getCheckInList.mockResolvedValue({
    event_id: 'e-1',
    event_name: 'Unwetter',
    personnel: [
      { id: 'p1', name: 'Acker Reto', checked_in: false, is_assigned: false },
      { id: 'p2', name: 'Bühler Nadja', checked_in: true, is_assigned: false },
    ],
  })
}

describe('/check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.isEditor = false
  })

  it('keeps an editor’s typed name through a failed poll and waits for a fresh roster before adding it', async () => {
    auth.isEditor = true
    roster()
    const user = userEvent.setup()
    renderWithIntl(<CheckInPage />)
    await user.click(await screen.findByRole('button', { name: 'Neue Person hinzufügen' }))
    const name = screen.getByPlaceholderText('Name eingeben …')
    await user.type(name, 'Muster Lea')

    api.getCheckInList.mockResolvedValueOnce(null)
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Acker Reto/ })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled()
    expect(name).toHaveValue('Muster Lea')
    await user.type(name, '{Enter}')
    expect(api.createPersonnel).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeEnabled())
    expect(screen.getByPlaceholderText('Name eingeben …')).toHaveValue('Muster Lea')
  })

  // #5 (19.11.2026): somebody added at the door belongs to tonight's Ereignis, not the roster.
  it('adds a person at the door as a guest of the Ereignis the link opens', async () => {
    auth.isEditor = true
    roster()
    api.createPersonnel.mockResolvedValue({ id: 'p9', name: 'Muster Lea' })
    api.checkInPersonnel.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithIntl(<CheckInPage />)
    await user.click(await screen.findByRole('button', { name: 'Neue Person hinzufügen' }))
    await user.type(screen.getByPlaceholderText('Name eingeben …'), 'Muster Lea{Enter}')

    await waitFor(() => expect(api.createPersonnel).toHaveBeenCalledWith(expect.objectContaining({ name: 'Muster Lea', guest_event_id: 'e-1' })))
    expect(api.checkInPersonnel).toHaveBeenCalledWith('p9', 'tok')
  })

  it('refreshes a token-only kiosk when it becomes visible again', async () => {
    roster()
    renderWithIntl(<CheckInPage />)
    await screen.findByRole('button', { name: /Acker Reto/ })
    api.getCheckInList.mockResolvedValue({
      event_name: 'Unwetter',
      personnel: [{ id: 'p1', name: 'Acker Reto', checked_in: true, is_assigned: false }],
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Acker Reto/ })).toHaveAccessibleDescription('Anwesend'))
  })

  it('a check-in clears the search for the next person at the door', async () => {
    roster()
    api.checkInPersonnel.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithIntl(<CheckInPage />)

    const search = await screen.findByPlaceholderText('Personal suchen …')
    await user.type(search, 'Acker')
    await user.click(await screen.findByRole('button', { name: /Acker Reto/ }))

    await waitFor(() => expect(search).toHaveValue(''))
    expect(api.checkInPersonnel).toHaveBeenCalledWith('p1', 'tok')
    expect(toast).not.toHaveBeenCalled()
  })

  it('a check-out says so with «Rückgängig», which checks the person back in', async () => {
    roster()
    api.checkOutPersonnel.mockResolvedValue(undefined)
    api.checkInPersonnel.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithIntl(<CheckInPage />)

    await user.click(await screen.findByRole('button', { name: /Bühler Nadja/ }))
    // bare toast(): toast.success is muted on a phone (a quiet surface)
    await waitFor(() => expect(toast).toHaveBeenCalled())
    const [message, options] = toast.mock.calls[0]
    expect(message).toBe('Bühler Nadja ausgecheckt.')
    expect(options.action.label).toBe('Rückgängig')

    options.action.onClick()
    await waitFor(() => expect(api.checkInPersonnel).toHaveBeenCalledWith('p2', 'tok'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Bühler Nadja/ })).toHaveAccessibleDescription('Anwesend'))
  })

  it('somebody checked in gives «bis …» through the link; somebody not in yet gets no chip', async () => {
    roster()
    api.setAttendancePlan.mockImplementation(async (_id, _door, plan) => ({ planned_until: plan.planned_until }))
    const user = userEvent.setup()
    renderWithIntl(<CheckInPage />)

    await user.click(await screen.findByRole('button', { name: 'Geht um setzen' }))
    expect(screen.getAllByRole('button', { name: 'Geht um setzen' })).toHaveLength(1)
    await user.type(await screen.findByLabelText('Ich bin da bis'), '23:30{Enter}')

    await waitFor(() => expect(api.setAttendancePlan).toHaveBeenCalledTimes(1))
    const [id, door, plan] = api.setAttendancePlan.mock.calls[0]
    expect([id, door]).toEqual(['p2', { token: 'tok' }])
    expect(new Date(plan.planned_until).getMinutes()).toBe(30)
    expect(await screen.findByRole('button', { name: 'Geht um 23:30 – ändern' })).toBeInTheDocument()
    expect(api.checkOutPersonnel).not.toHaveBeenCalled()
  })

  // Owner, 24.11.2026: the «+ bis» chip hung between two cards. It belongs in the card, beside
  // the state pill – and nothing else may sit between the cards.
  it('puts the «bis» chip inside the person\'s card, beside the state pill', async () => {
    roster()
    renderWithIntl(<CheckInPage />)
    const chip = await screen.findByRole('button', { name: 'Geht um setzen' })
    const card = chip.closest('[data-testid="checkin-card"]')
    expect(card).toHaveTextContent('Bühler Nadja')
    expect(chip.parentElement).toHaveTextContent('Anwesend')
    const list = card!.parentElement!
    expect([...list.children].every(child => child.matches('[data-testid="checkin-card"]'))).toBe(true)
  })
})

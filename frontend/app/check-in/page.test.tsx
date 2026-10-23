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
}))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('@/lib/websocket-client', () => ({ wsClient: { connect: vi.fn(), disconnect: vi.fn(), on: () => () => {} } }))
vi.mock('@/components/quick-add-personnel', () => ({ QuickAddPersonnel: () => null }))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import CheckInPage from '@/app/check-in/page'

function roster() {
  api.getCheckInList.mockResolvedValue({
    event_name: 'Unwetter',
    personnel: [
      { id: 'p1', name: 'Acker Reto', checked_in: false, is_assigned: false },
      { id: 'p2', name: 'Bühler Nadja', checked_in: true, is_assigned: false },
    ],
  })
}

describe('/check-in', () => {
  beforeEach(() => vi.clearAllMocks())

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
    await waitFor(() => expect(screen.getByRole('button', { name: /Bühler Nadja/ })).toHaveTextContent('Anwesend'))
  })
})

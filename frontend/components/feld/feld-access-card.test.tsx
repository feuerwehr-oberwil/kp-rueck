import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'

const getFeldAccess = vi.hoisted(() => vi.fn())
const regenerateFeldCode = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { getFeldAccess, regenerateFeldCode } }))
const auth = vi.hoisted(() => ({ user: { id: 'editor-1' } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth }))

import { FeldAccessCard, prefetchFeldAccess } from '@/components/feld/feld-access-card'

describe('FeldAccessCard', () => {
  // The Links & QR sheet rises at its final height: the code is there on the first frame
  // when the sheet prefetched it while closed (feedback 19.11.2026).
  it('shows a prefetched code on its first render, without a skeleton', async () => {
    getFeldAccess.mockResolvedValue({ code: '0634', device_count: 1 })
    await prefetchFeldAccess('editor-1', 'event-1')

    getFeldAccess.mockReturnValue(new Promise(() => {})) // the mount's refresh never answers
    renderWithIntl(<FeldAccessCard eventId="event-1" />)
    expect(screen.getByText('0634')).toBeInTheDocument()
  })

  // A logout does not reload the page: a viewer signing in on the same tab gets no editor's code.
  it('does not show another user\'s code', () => {
    auth.user = { id: 'viewer-1' }
    getFeldAccess.mockReturnValue(new Promise(() => {}))
    renderWithIntl(<FeldAccessCard eventId="event-1" />)
    expect(screen.queryByText('0634')).not.toBeInTheDocument()
    auth.user = { id: 'editor-1' }
  })

  it('drops a remembered code when the refresh fails', async () => {
    getFeldAccess.mockResolvedValue({ code: '0634', device_count: 1 })
    await prefetchFeldAccess('editor-1', 'event-3')

    getFeldAccess.mockRejectedValue(new Error('offline'))
    renderWithIntl(<FeldAccessCard eventId="event-3" />)
    expect(screen.getByText('0634')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('0634')).not.toBeInTheDocument())
  })

  // A refresh that was already on its way must not undo a «Neu» that answered first.
  it('keeps a just-made code when an older refresh fails after it', async () => {
    const user = userEvent.setup()
    getFeldAccess.mockResolvedValue({ code: '0634', device_count: 1 })
    await prefetchFeldAccess('editor-1', 'event-4')

    let failRefresh: (error: Error) => void = () => {}
    getFeldAccess.mockReturnValue(new Promise((_, reject) => { failRefresh = reject }))
    regenerateFeldCode.mockResolvedValue({ code: '9999', device_count: 1 })
    renderWithIntl(<FeldAccessCard eventId="event-4" />)

    await user.click(screen.getByRole('button', { name: /Neu/ }))
    const question = await screen.findByRole('alertdialog')
    await user.click(within(question).getByRole('button', { name: 'Neu' }))
    await screen.findByText('9999')
    await act(async () => failRefresh(new Error('late')))
    expect(screen.getByText('9999')).toBeInTheDocument()
  })

  it('does not show another Ereignis\'s code', () => {
    getFeldAccess.mockReturnValue(new Promise(() => {}))
    renderWithIntl(<FeldAccessCard eventId="event-2" />)
    expect(screen.queryByText('0634')).not.toBeInTheDocument()
  })
})

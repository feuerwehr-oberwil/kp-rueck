import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithIntl } from '@/test-utils/render-with-intl'

const getFeldAccess = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { getFeldAccess } }))
const auth = vi.hoisted(() => ({ user: { id: 'editor-1' } as { id: string } | null }))
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

  it('does not show another Ereignis\'s code', () => {
    getFeldAccess.mockReturnValue(new Promise(() => {}))
    renderWithIntl(<FeldAccessCard eventId="event-2" />)
    expect(screen.queryByText('0634')).not.toBeInTheDocument()
  })
})

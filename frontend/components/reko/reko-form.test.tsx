import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { ApiError } from '@/lib/api/types'

/**
 * A dead Reko link (sweep 2026-10-23, UX-PHONE-09): the /alarm card — one
 * message, in the crew's words. Not «Token möglicherweise ungültig» beside an
 * «API Fehler» toast.
 */

const params = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => params.value,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))
const getRekoForm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({ apiClient: { getRekoForm } }))
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import RekoForm from '@/components/reko/reko-form'

describe('RekoForm — a dead link', () => {
  it('a link the server refuses gets the one card, no jargon, no toast', async () => {
    params.value = new URLSearchParams({ incident_id: 'inc-1', token: 'old' })
    getRekoForm.mockRejectedValueOnce(new ApiError('Dieser Reko-Link ist ungültig oder abgelaufen.', 403))
    renderWithIntl(<RekoForm />)

    expect(await screen.findByRole('heading', { name: 'Link ungültig oder abgelaufen' })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/Token/)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a link without a token gets the same card', async () => {
    params.value = new URLSearchParams({ incident_id: 'inc-1' })
    renderWithIntl(<RekoForm />)
    expect(await screen.findByRole('heading', { name: 'Link ungültig oder abgelaufen' })).toBeInTheDocument()
    expect(getRekoForm).not.toHaveBeenCalled()
  })

  it('a connection failure is not called a dead link', async () => {
    params.value = new URLSearchParams({ incident_id: 'inc-1', token: 'ok' })
    getRekoForm.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderWithIntl(<RekoForm />)
    expect(await screen.findByText(/konnte nicht geladen werden/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Link ungültig oder abgelaufen' })).toBeNull()
  })
})

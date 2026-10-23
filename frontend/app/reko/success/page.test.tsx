import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/** After sending (UX-PHONE-08): the address, never the UUID; «Zurück» only with a `return_to`. */

const params = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => params.value,
  useRouter: () => ({ push: vi.fn() }),
}))

import RekoSuccessPage from '@/app/reko/success/page'

describe('/reko/success', () => {
  it('names the Einsatz by its address and offers no way «back» into a login', () => {
    params.value = new URLSearchParams({ ort: 'Bahnhofstrasse 22' })
    renderWithIntl(<RekoSuccessPage />)
    expect(screen.getByText('Bahnhofstrasse 22 – an die Einsatzleitung übermittelt.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('goes back only to one of our own paths', () => {
    params.value = new URLSearchParams({ ort: 'Bahnhofstrasse 22', return_to: '/feld' })
    const { unmount } = renderWithIntl(<RekoSuccessPage />)
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeInTheDocument()
    unmount()

    params.value = new URLSearchParams({ return_to: 'https://example.com' })
    renderWithIntl(<RekoSuccessPage />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

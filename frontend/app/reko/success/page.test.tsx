import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/** After sending from an alarm / QR link (UX-PHONE-08): the address, never the UUID, and no way «back». */

const params = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => params.value,
}))

import RekoSuccessPage from '@/app/reko/success/page'

describe('/reko/success', () => {
  it('names the Einsatz by its address and offers no way «back» into a login', () => {
    params.value = new URLSearchParams({ ort: 'Bahnhofstrasse 22' })
    renderWithIntl(<RekoSuccessPage />)
    expect(screen.getByText('Bahnhofstrasse 22 – an die Einsatzleitung übermittelt.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

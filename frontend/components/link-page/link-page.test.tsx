import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LinkPageHeader } from '@/components/link-page/link-page'

describe('LinkPageHeader', () => {
  it('is one opaque sticky bar with the title as the page heading', () => {
    render(<LinkPageHeader title="Personal-Check-in" subtitle="Unwetter Oberwil" />)
    const header = document.querySelector('[data-slot="link-page-header"]')!
    expect(header).toHaveClass('sticky', 'top-0', 'bg-background')
    expect(header.className).not.toMatch(/backdrop-blur|\/\d+/)
    expect(screen.getByRole('heading', { name: 'Personal-Check-in' })).toBeInTheDocument()
    expect(screen.getByText('Unwetter Oberwil')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MelderLink } from '@/components/ui/melder-link'

describe('MelderLink', () => {
  it('is ONE tel: link with the name and the whole number on their own lines', () => {
    render(<MelderLink contact="Bühler Werner" phone="061 111 11 11" />)
    const link = screen.getByRole('link', { name: 'Bühler Werner · 061 111 11 11' })
    expect(link.getAttribute('href')).toBe('tel:0611111111')
    const [name, number] = [...link.children]
    expect(name.textContent).toBe('Bühler Werner')
    expect(number.textContent).toBe('061 111 11 11')
    expect(number.className).toContain('whitespace-nowrap')
  })

  it('draws a number with nothing to dial as text, not a dead link', () => {
    render(<MelderLink phone="–" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('–')).toBeTruthy()
  })
})

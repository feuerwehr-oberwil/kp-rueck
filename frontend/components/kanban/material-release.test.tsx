import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

import { MaterialReleaseButton } from '@/components/kanban/material-release'

const unit = (name: string, used = true) => ({ assignment_id: `a-${name}`, material_id: `m-${name}`, name, location: null, used, answered: true })

describe('MaterialReleaseButton', () => {
  it('renders nothing for an empty set', () => {
    const { container } = renderWithIntl(<MaterialReleaseButton units={[]} disabled={false} releasing={false} onRelease={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the units the button frees, an unused one marked', () => {
    renderWithIntl(
      <MaterialReleaseButton units={[unit('Generator'), unit('Wassersauger', false)]} disabled={false} releasing={false} onRelease={vi.fn()} />,
    )

    expect(screen.getByRole('button', { name: /2 Geräte freigeben/ })).toBeInTheDocument()
    expect(screen.getByText('Noch zugewiesen: Generator, Wassersauger (nicht gebraucht)')).toBeInTheDocument()
  })
})

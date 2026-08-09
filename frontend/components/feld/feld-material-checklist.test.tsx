import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportMaterialRow } from '@/lib/api/types'

import { FeldMaterialChecklist } from '@/components/feld/feld-material-checklist'

function material(overrides: Partial<ApiRapportMaterialRow> = {}): ApiRapportMaterialRow {
  return {
    assignment_id: 'a1',
    material_id: 'm1',
    name: 'Tauchpumpe TP-4',
    location: 'Magazin A',
    consumable: false,
    used: null,
    left_on_site: false,
    on_board: true,
    ...overrides,
  }
}

describe('FeldMaterialChecklist — Weiteres Material', () => {
  it('asks in the crew’s own terms, never about "das Board"', () => {
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[material()]}
        extraNote=""
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    // A crew in the field has never seen the board and does not know the word.
    const label = screen.getByText('Weiteres gebrauchtes Material')
    expect(label).toBeInTheDocument()
    expect(screen.getByText(/oben nicht aufgeführt/)).toBeInTheDocument()
    expect(screen.queryByText(/Board/)).toBeNull()
  })

  it('offers the catalogue names as suggestions', () => {
    const { container } = renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote=""
        suggestions={['Motorsäge', 'Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Weiteres gebrauchtes Material')
    expect(input).toHaveAttribute('list', 'rapport-extra-material-options')
    const options = Array.from(container.querySelectorAll('datalist option')).map(o =>
      o.getAttribute('value'),
    )
    expect(options).toEqual(['Motorsäge', 'Nassauger'])
  })

  it('keeps free text valid — a suggestion is a spelling aid, not a picker', async () => {
    const onExtraNoteChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote=""
        suggestions={['Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={onExtraNoteChange}
      />,
    )

    await userEvent.type(screen.getByLabelText('Weiteres gebrauchtes Material'), 'Z')
    // Nothing here carries an id and nothing here creates an assignment
    // (decision 18) — the note is and stays a plain string.
    expect(onExtraNoteChange).toHaveBeenCalledWith('Z')
  })

  it('renders no datalist at all when there is nothing to suggest', () => {
    const { container } = renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote=""
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )
    expect(container.querySelector('datalist')).toBeNull()
    expect(screen.getByLabelText('Weiteres gebrauchtes Material')).not.toHaveAttribute('list')
  })
})

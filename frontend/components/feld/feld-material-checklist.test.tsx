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
    // The label and the examples in the placeholder carry it; the sentence that
    // used to explain the field again was dropped with the rest of the
    // hand-holding copy.
    expect(screen.getByText('Weiteres gebrauchtes Material')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/geliehene Tauchpumpe/)).toBeInTheDocument()
    expect(screen.queryByText(/Board/)).toBeNull()
  })

  it('shows the whole catalogue on focus — nothing to type first', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote=""
        suggestions={['Motorsäge', 'Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    // This is the whole point of dropping the <datalist>: a native one only
    // appears once you are already typing, so there was nothing to browse.
    expect(screen.queryByText('Motorsäge')).toBeNull()
    await user.click(screen.getByLabelText('Weiteres gebrauchtes Material'))

    expect(await screen.findByText('Motorsäge')).toBeInTheDocument()
    expect(screen.getByText('Nassauger')).toBeInTheDocument()
  })

  it('filters the list while typing', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote="Nass"
        suggestions={['Motorsäge', 'Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    await user.click(screen.getByLabelText('Weiteres gebrauchtes Material'))

    expect(await screen.findByText('Nassauger')).toBeInTheDocument()
    expect(screen.queryByText('Motorsäge')).toBeNull()
  })

  it('inserts a picked name as plain text, carrying no id', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByLabelText('Weiteres gebrauchtes Material'))
    await user.click(await screen.findByText('Nassauger'))

    // A string, and only a string (decision 18) — picking a name is not
    // picking a unit, and /feld still never writes an assignment.
    expect(onExtraNoteChange).toHaveBeenCalledWith('Nassauger')
  })

  it('appends behind a comma so a second unit can be picked too', async () => {
    const user = userEvent.setup()
    const onExtraNoteChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote="geliehene Tauchpumpe,"
        suggestions={['Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={onExtraNoteChange}
      />,
    )

    await user.click(screen.getByLabelText('Weiteres gebrauchtes Material'))
    await user.click(await screen.findByText('Nassauger'))

    expect(onExtraNoteChange).toHaveBeenCalledWith('geliehene Tauchpumpe, Nassauger')
  })

  it('accepts a name that is in no catalogue at all', async () => {
    const user = userEvent.setup()
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

    const input = screen.getByLabelText('Weiteres gebrauchtes Material')
    await user.type(input, 'Z')
    // No match, and the field neither clears nor complains: free text is the
    // data model, the list is only a spelling aid.
    expect(onExtraNoteChange).toHaveBeenCalledWith('Z')
    expect(screen.getByText('Nicht dabei? Einfach tippen – jeder Text ist gültig.')).toBeInTheDocument()
  })

  it('leaves Enter to the free text until an arrow key points at a row', async () => {
    const user = userEvent.setup()
    const onExtraNoteChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote=""
        suggestions={['Motorsäge', 'Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={onExtraNoteChange}
      />,
    )

    const input = screen.getByLabelText('Weiteres gebrauchtes Material')
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(onExtraNoteChange).not.toHaveBeenCalled()

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onExtraNoteChange).toHaveBeenCalledWith('Nassauger')
  })

  it('is a plain text field when there is nothing to suggest', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote=""
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    const input = screen.getByLabelText('Weiteres gebrauchtes Material')
    expect(input).not.toHaveAttribute('role', 'combobox')
    expect(screen.queryByRole('button', { name: 'Materialliste anzeigen' })).toBeNull()
    await user.click(input)
    expect(screen.queryByText('Nicht dabei? Einfach tippen – jeder Text ist gültig.')).toBeNull()
  })
})

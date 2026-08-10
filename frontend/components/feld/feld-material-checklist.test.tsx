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
    used: true,
    left_on_site: false,
    on_board: true,
    ...overrides,
  }
}

describe('FeldMaterialChecklist — gebraucht', () => {
  it('is a plain tick, prefilled ja', () => {
    // §18.29: the three-state ✓/✗/– control is gone. The unit was dispatched
    // here, so "gebraucht" is the board's own answer and the crew unticks the
    // exceptions — the same shape as the vehicle list.
    renderWithIntl(
      <FeldMaterialChecklist rows={[material()]} extraNote="" onChange={vi.fn()} onExtraNoteChange={vi.fn()} />,
    )

    expect(screen.getByRole('checkbox', { name: 'Gebraucht: Tauchpumpe TP-4' })).toBeChecked()
    expect(screen.queryByText('Keine Angabe')).toBeNull()
  })

  it('unticks the row that was clicked and nothing else', async () => {
    const onChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[material(), material({ assignment_id: 'a2', material_id: 'm2', name: 'Motorsäge' })]}
        extraNote=""
        onChange={onChange}
        onExtraNoteChange={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: 'Gebraucht: Tauchpumpe TP-4' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ assignment_id: 'a1', used: false }),
      expect.objectContaining({ assignment_id: 'a2', used: true }),
    ])
  })

  it('gives a consumable one tick and no second one (decision 26)', () => {
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[material({ consumable: true, name: 'Ölbindemittel' })]}
        extraNote=""
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Gebraucht: Ölbindemittel' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Vor Ort verblieben/ })).toBeNull()
  })
})

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
    expect(screen.getByText('Weiteres gebrauchtes Material')).toBeInTheDocument()
    expect(screen.queryByText(/Board/)).toBeNull()
  })

  it('shows the whole catalogue straight away — nothing to type first', () => {
    // §18.31: a multi-select, in the shape the app uses for picking people.
    // Neither the datalist nor the combobox before it showed anything until you
    // had already started typing.
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote=""
        suggestions={['Motorsäge', 'Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /Motorsäge/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nassauger/ })).toBeInTheDocument()
  })

  it('picks a name as plain text, carrying no id', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: /Nassauger/ }))

    // A string, and only a string (decision 18) — picking a name is not picking
    // a unit, and /feld still never writes an assignment.
    expect(onExtraNoteChange).toHaveBeenCalledWith('Nassauger')
  })

  it('adds a second pick instead of replacing the first', async () => {
    const onExtraNoteChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote="Nassauger"
        suggestions={['Nassauger', 'Motorsäge']}
        onChange={vi.fn()}
        onExtraNoteChange={onExtraNoteChange}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Motorsäge/ }))

    expect(onExtraNoteChange).toHaveBeenCalledWith('Nassauger, Motorsäge')
  })

  it('shows the picked names as chips and takes them back off', async () => {
    const onExtraNoteChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote="Nassauger"
        suggestions={['Nassauger', 'Motorsäge']}
        onChange={vi.fn()}
        onExtraNoteChange={onExtraNoteChange}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Nassauger entfernen' }))
    expect(onExtraNoteChange).toHaveBeenCalledWith('')
  })

  it('keeps free text for something that is in no catalogue at all', async () => {
    const onExtraNoteChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote="Nassauger"
        suggestions={['Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={onExtraNoteChange}
      />,
    )

    // A crew that borrowed the neighbouring brigade's pump has to be able to
    // write it — the catalogue is a naming aid, not the vocabulary.
    await userEvent.type(screen.getByLabelText('Weiteres gebrauchtes Material'), 'P')
    expect(onExtraNoteChange).toHaveBeenLastCalledWith('Nassauger, P')
  })

  it('separates the picked catalogue names from the typed ones', () => {
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraNote="Nassauger, Pumpe vom Nachbarzug"
        suggestions={['Nassauger']}
        onChange={vi.fn()}
        onExtraNoteChange={vi.fn()}
      />,
    )

    // The stored string is the single source of truth and comes back apart into
    // the same two controls on the next phone.
    expect(screen.getByRole('button', { name: 'Nassauger entfernen' })).toBeInTheDocument()
    expect(screen.getByLabelText('Weiteres gebrauchtes Material')).toHaveValue('Pumpe vom Nachbarzug')
  })

  it('is a plain text field when there is nothing to suggest', () => {
    renderWithIntl(
      <FeldMaterialChecklist rows={[]} extraNote="" onChange={vi.fn()} onExtraNoteChange={vi.fn()} />,
    )

    expect(screen.getByLabelText('Weiteres gebrauchtes Material')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nassauger/ })).toBeNull()
  })
})

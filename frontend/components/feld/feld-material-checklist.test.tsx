import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportExtraMaterial, ApiRapportMaterialRow } from '@/lib/api/types'

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
    // §18.32: the three-state ✓/✗/– control is gone. The unit was dispatched
    // here, so "gebraucht" is the board's own answer and the crew unticks the
    // exceptions — the same shape as the vehicle list.
    renderWithIntl(
      <FeldMaterialChecklist rows={[material()]} extraMaterials={[]} onChange={vi.fn()} onExtraMaterialsChange={vi.fn()} />,
    )

    expect(screen.getByRole('checkbox', { name: 'Gebraucht: Tauchpumpe TP-4' })).toBeChecked()
    expect(screen.queryByText('Keine Angabe')).toBeNull()
  })

  it('unticks the row that was clicked and nothing else', async () => {
    const onChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[material(), material({ assignment_id: 'a2', material_id: 'm2', name: 'Motorsäge' })]}
        extraMaterials={[]}
        onChange={onChange}
        onExtraMaterialsChange={vi.fn()}
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
        extraMaterials={[]}
        onChange={vi.fn()}
        onExtraMaterialsChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: 'Gebraucht: Ölbindemittel' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Vor Ort verblieben/ })).toBeNull()
  })
})

describe('FeldMaterialChecklist — Weiteres Material', () => {
  const entry = (name: string, leftOnSite = false): ApiRapportExtraMaterial => ({
    name,
    left_on_site: leftOnSite,
  })

  it('asks in the crew’s own terms, never about "das Board"', () => {
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[material()]}
        extraMaterials={[]}
        onChange={vi.fn()}
        onExtraMaterialsChange={vi.fn()}
      />,
    )

    // A crew in the field has never seen the board and does not know the word.
    expect(screen.getByText('Weiteres gebrauchtes Material')).toBeInTheDocument()
    expect(screen.queryByText(/Board/)).toBeNull()
  })

  /** Opens «Material hinzufügen» and returns its sheet. */
  async function openPicker() {
    await userEvent.click(screen.getByRole('button', { name: 'Material hinzufügen' }))
    return screen.findByRole('dialog')
  }

  it('offers the whole catalogue behind one button, without typing a name first', async () => {
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraMaterials={[]}
        suggestions={['Motorsäge', 'Nassauger']}
        onChange={vi.fn()}
        onExtraMaterialsChange={vi.fn()}
      />,
    )

    const sheet = await openPicker()
    expect(within(sheet).getByRole('button', { name: 'Motorsäge' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Nassauger' })).toBeInTheDocument()
  })

  it('adds picks as entries after what is there, carrying no id', async () => {
    const onExtraMaterialsChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraMaterials={[entry('Nassauger')]}
        suggestions={['Nassauger', 'Motorsäge']}
        onChange={vi.fn()}
        onExtraMaterialsChange={onExtraMaterialsChange}
      />,
    )

    const sheet = await openPicker()
    // Already on the list: not offered twice — taking it out is the row's ✕.
    expect(within(sheet).queryByRole('button', { name: 'Nassauger' })).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Motorsäge' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))

    // A name and one tick, and nothing else (decision 18) — picking a name is
    // not picking a unit, and /feld still never writes an assignment.
    expect(onExtraMaterialsChange).toHaveBeenCalledWith([
      { name: 'Nassauger', left_on_site: false },
      { name: 'Motorsäge', left_on_site: false },
    ])
  })

  it('shows every entry as a row and takes it back off', async () => {
    const onExtraMaterialsChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraMaterials={[entry('Nassauger')]}
        suggestions={['Nassauger', 'Motorsäge']}
        onChange={vi.fn()}
        onExtraMaterialsChange={onExtraMaterialsChange}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Nassauger entfernen' }))
    expect(onExtraMaterialsChange).toHaveBeenCalledWith([])
  })

  it('gives each entry its own "vor Ort verblieben" and no gebraucht tick (§18.35)', async () => {
    // The whole point: one borrowed thing stays in the cellar while the other
    // goes home with the crew. Listing it here already means it was used, so
    // there is no second tick to hit.
    const onExtraMaterialsChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraMaterials={[entry('Nassauger'), entry('Pumpe vom Nachbarzug')]}
        suggestions={['Nassauger']}
        onChange={vi.fn()}
        onExtraMaterialsChange={onExtraMaterialsChange}
      />,
    )

    expect(screen.queryByRole('checkbox', { name: /^Gebraucht:/ })).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Vor Ort verblieben: Pumpe vom Nachbarzug' }))

    expect(onExtraMaterialsChange).toHaveBeenCalledWith([
      { name: 'Nassauger', left_on_site: false },
      { name: 'Pumpe vom Nachbarzug', left_on_site: true },
    ])
  })

  it('says why a left-behind name is not in the release list', () => {
    // The asymmetry of decision 18 made visible: the Abholliste fetches it,
    // "Material zurück – freigeben" has no assignment to free.
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraMaterials={[entry('Pumpe vom Nachbarzug', true)]}
        onChange={vi.fn()}
        onExtraMaterialsChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/Abholliste/)).toBeInTheDocument()
    expect(screen.getByText(/kein erfasstes Material/)).toBeInTheDocument()
  })

  it('takes a typed name for something that is in no catalogue at all', async () => {
    const onExtraMaterialsChange = vi.fn()
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraMaterials={[entry('Nassauger')]}
        suggestions={['Nassauger']}
        onChange={vi.fn()}
        onExtraMaterialsChange={onExtraMaterialsChange}
      />,
    )

    // A crew that borrowed the neighbouring brigade's pump has to be able to
    // write it — the catalogue is a naming aid, not the vocabulary.
    const sheet = await openPicker()
    await userEvent.type(within(sheet).getByPlaceholderText('Material suchen …'), 'Pumpe vom Nachbarzug')
    await userEvent.click(within(sheet).getByRole('button', { name: '«Pumpe vom Nachbarzug» hinzufügen' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))
    expect(onExtraMaterialsChange).toHaveBeenCalledWith([
      { name: 'Nassauger', left_on_site: false },
      { name: 'Pumpe vom Nachbarzug', left_on_site: false },
    ])
  })

  it('reads a rapport saved with the old comma line back as rows', () => {
    // Typed and picked names were always the same `{name, left_on_site}` entry,
    // so nothing saved before the picker needs converting.
    renderWithIntl(
      <FeldMaterialChecklist
        rows={[]}
        extraMaterials={[entry('Nassauger'), entry('Pumpe vom Nachbarzug', true)]}
        suggestions={['Nassauger']}
        onChange={vi.fn()}
        onExtraMaterialsChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Nassauger entfernen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pumpe vom Nachbarzug entfernen' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Vor Ort verblieben: Pumpe vom Nachbarzug' })).toBeChecked()
  })
})

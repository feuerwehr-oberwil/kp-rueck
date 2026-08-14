import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportPersonnelRow } from '@/lib/api/types'

import { FeldPersonnelChecklist } from '@/components/feld/feld-personnel-checklist'

function person(overrides: Partial<ApiRapportPersonnelRow> = {}): ApiRapportPersonnelRow {
  return {
    personnel_id: 'p1',
    name: 'Muster Hans',
    present: true,
    on_board: true,
    ...overrides,
  }
}

function render(props: Partial<React.ComponentProps<typeof FeldPersonnelChecklist>> = {}) {
  return renderWithIntl(
    <FeldPersonnelChecklist
      rows={[person()]}
      extra={[]}
      onChange={vi.fn()}
      onExtraChange={vi.fn()}
      {...props}
    />,
  )
}

describe('FeldPersonnelChecklist', () => {
  it('offers the roll-call with the dispatched names ticked', () => {
    render({
      rows: [person(), person({ personnel_id: 'p2', name: 'Koch René', present: false, on_board: false })],
    })
    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Koch René/ })).not.toBeChecked()
  })

  it('records somebody who came along without being aufgeboten', async () => {
    const onChange = vi.fn()
    render({
      rows: [person({ personnel_id: 'p2', name: 'Koch René', present: false, on_board: false })],
      onChange,
    })
    await userEvent.click(screen.getByRole('checkbox', { name: /Koch René/ }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ personnel_id: 'p2', present: true })])
  })

  it('records somebody who went home', async () => {
    const onChange = vi.fn()
    render({ onChange })
    await userEvent.click(screen.getByRole('checkbox', { name: /Muster Hans/ }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ personnel_id: 'p1', present: false })])
  })

  it('takes a name and a note for somebody on no roster of this station', async () => {
    const onExtraChange = vi.fn()
    render({ onExtraChange })

    await userEvent.type(screen.getByPlaceholderText('Weitere Person (Name)'), 'Bräm Urs')
    await userEvent.type(screen.getByPlaceholderText(/FW Allschwil/), 'FW Allschwil, ab 21:00')
    await userEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    expect(onExtraChange).toHaveBeenCalledWith([{ name: 'Bräm Urs', note: 'FW Allschwil, ab 21:00' }])
  })

  it('counts ticked names plus hand-added ones in the heading', () => {
    render({
      rows: [person(), person({ personnel_id: 'p2', name: 'Koch René', present: false, on_board: true })],
      extra: [{ name: 'Bräm Urs', note: '' }],
    })
    expect(screen.getByText(/\(2\)/)).toBeInTheDocument()
  })

  it('folds a thirty-name roll-call down to who was dispatched', async () => {
    const rows = [
      person(),
      ...Array.from({ length: 29 }, (_, i) =>
        person({ personnel_id: `x${i}`, name: `Angemeldet ${i}`, present: false, on_board: false }),
      ),
    ]
    render({ rows })

    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /Angemeldet 7/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Weitere Angemeldete \(29\)/ }))
    expect(screen.getByRole('checkbox', { name: /Angemeldet 7/ })).toBeInTheDocument()
  })

  it('offers no controls in a read-only mount', () => {
    render({ disabled: true, extra: [{ name: 'Bräm Urs', note: '' }] })
    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).toBeDisabled()
    expect(screen.queryByPlaceholderText('Weitere Person (Name)')).not.toBeInTheDocument()
  })
})

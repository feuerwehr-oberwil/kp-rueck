import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportPersonnelCandidate, ApiRapportPersonnelRow } from '@/lib/api/types'

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

function candidate(overrides: Partial<ApiRapportPersonnelCandidate> = {}): ApiRapportPersonnelCandidate {
  return { personnel_id: 'c1', name: 'Koch René', checked_in: true, ...overrides }
}

function render(props: Partial<React.ComponentProps<typeof FeldPersonnelChecklist>> = {}) {
  return renderWithIntl(
    <FeldPersonnelChecklist
      rows={[person()]}
      extra={[]}
      candidates={[]}
      onChange={vi.fn()}
      onExtraChange={vi.fn()}
      {...props}
    />,
  )
}

describe('FeldPersonnelChecklist', () => {
  it('gives a chip to the aufgebotenen only — the roster is not a checklist', () => {
    render({
      rows: [person()],
      // Checked in tonight, but nobody sent them to THIS Schadenplatz.
      candidates: [candidate(), candidate({ personnel_id: 'c2', name: 'Wyss Peter', checked_in: false })],
    })
    const list = screen.getByRole('list', { name: 'Mannschaft' })
    expect(within(list).getByText('Muster Hans')).toBeInTheDocument()
    expect(within(list).queryByText('Koch René')).toBeNull()
  })

  it('marks the Einsatzleiter with «EL»', () => {
    render({ rows: [person(), person({ personnel_id: 'p2', name: 'Gatti Olivier' })], leaderId: 'p2' })
    const chip = screen.getByText('Gatti Olivier').closest('li')
    expect(within(chip as HTMLElement).getByText('EL')).toBeInTheDocument()
    expect(within(screen.getByText('Muster Hans').closest('li') as HTMLElement).queryByText('EL')).toBeNull()
  })

  it('records somebody who went home: the ✕ answers «nein», it does not drop the row', async () => {
    const onChange = vi.fn()
    render({ onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Muster Hans entfernen' }))
    expect(onChange).toHaveBeenCalledWith([{ personnel_id: 'p1', name: 'Muster Hans', present: false, on_board: true }])
  })

  it('offers a removed aufgebotene person again under «Aufgeboten» — the way back', async () => {
    const onChange = vi.fn()
    render({ rows: [person({ present: false })], candidates: [candidate()], onChange })
    expect(screen.queryByText('Muster Hans')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Person hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Aufgeboten')).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Muster Hans' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))
    // The same row, ticked again – not a second one.
    expect(onChange).toHaveBeenCalledWith([{ personnel_id: 'p1', name: 'Muster Hans', present: true, on_board: true }])
  })

  it('adds somebody the board never sent, with their personnel_id and not as free text', async () => {
    const onChange = vi.fn()
    render({ candidates: [candidate(), candidate({ personnel_id: 'c2', name: 'Wyss Peter', checked_in: false })], onChange })

    await userEvent.click(screen.getByRole('button', { name: 'Person hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    // A tap ticks and the sheet stays open (owner pick 2A) — nothing is added yet.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Koch René' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Wyss Peter' }))
    expect(onChange).not.toHaveBeenCalled()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (2)' }))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ personnel_id: 'p1' }),
      { personnel_id: 'c1', name: 'Koch René', present: true, on_board: false },
      { personnel_id: 'c2', name: 'Wyss Peter', present: true, on_board: false },
    ])
  })

  it('takes an added name back off by unticking, and offers it again', async () => {
    // Dropping the row looks the same on screen and loses the removal on the
    // way out: the save reconciles the payload against what is stored, so a row
    // the payload never mentions is kept.
    const onChange = vi.fn()
    const { rerender } = render({
      rows: [person(), person({ personnel_id: 'c1', name: 'Koch René', on_board: false })],
      candidates: [candidate()],
      onChange,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Koch René entfernen' }))
    const next = onChange.mock.calls[0][0] as ApiRapportPersonnelRow[]
    expect(next[1]).toEqual({ personnel_id: 'c1', name: 'Koch René', present: false, on_board: false })

    rerender(<FeldPersonnelChecklist rows={next} extra={[]} candidates={[candidate()]} onChange={onChange} onExtraChange={vi.fn()} />)
    expect(screen.queryByText('Koch René')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Person hinzufügen' }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Koch René' })).toBeInTheDocument()
  })

  it('adds a typed name nobody has on a roster as a guest, without a note', async () => {
    const onExtraChange = vi.fn()
    render({ onExtraChange })

    await userEvent.click(screen.getByRole('button', { name: 'Person hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByPlaceholderText('Person suchen …'), 'Bräm Urs')
    await userEvent.click(within(sheet).getByRole('button', { name: '«Bräm Urs» als Gast hinzufügen' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))

    expect(onExtraChange).toHaveBeenCalledWith([{ name: 'Bräm Urs', note: '' }])
  })

  it('still shows the note of a guest saved before the Notiz field went', () => {
    render({ extra: [{ name: 'Bräm Urs', note: 'FW Allschwil' }] })
    const chip = screen.getByText('Bräm Urs').closest('li') as HTMLElement
    expect(within(chip).getByText('Gast')).toBeInTheDocument()
    expect(within(chip).getByText(/FW Allschwil/)).toBeInTheDocument()
  })

  it('offers the Appell first, then the rest of the roster, each by name', async () => {
    // The server sends rank order; a picker searched by name reads alphabetically.
    render({
      candidates: [
        candidate({ personnel_id: 'c4', name: 'Suter Elias', checked_in: false }),
        candidate({ personnel_id: 'c1', name: 'Graf Thomas', checked_in: true }),
        candidate({ personnel_id: 'c3', name: 'Ammann Lea', checked_in: false }),
        candidate({ personnel_id: 'c2', name: 'Berger Nina', checked_in: true }),
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Person hinzufügen' }))
    const text = (await screen.findByRole('dialog')).textContent ?? ''
    const order = ['Heute anwesend', 'Berger Nina', 'Graf Thomas', 'Alle', 'Ammann Lea', 'Suter Elias'].map(word =>
      text.indexOf(word),
    )
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('offers no controls in a read-only mount', () => {
    render({ disabled: true, extra: [{ name: 'Bräm Urs', note: '' }] })
    expect(screen.getByText('Muster Hans')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

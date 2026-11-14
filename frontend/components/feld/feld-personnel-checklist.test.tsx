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
  it('gives a row to the aufgebotenen only — the roster is not a checklist', () => {
    render({
      rows: [person()],
      // Checked in tonight, but nobody sent them to THIS Schadenplatz.
      candidates: [candidate(), candidate({ personnel_id: 'c2', name: 'Wyss Peter', checked_in: false })],
    })
    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /Koch René/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Wyss Peter/ })).not.toBeInTheDocument()
  })

  it('records somebody who went home', async () => {
    const onChange = vi.fn()
    render({ onChange })
    await userEvent.click(screen.getByRole('checkbox', { name: /Muster Hans/ }))
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ personnel_id: 'p1', present: false })])
  })

  it('keeps an unticked aufgebotene name in place — a nein is a correction, not a deletion', async () => {
    render({ rows: [person({ present: false })] })
    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).toBeInTheDocument()
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
    expect(within(sheet).getByRole('button', { name: 'Koch René' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (2)' }))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ personnel_id: 'p1' }),
      { personnel_id: 'c1', name: 'Koch René', present: true, on_board: false },
      { personnel_id: 'c2', name: 'Wyss Peter', present: true, on_board: false },
    ])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('takes an added name back off the list by unticking, not by dropping it', async () => {
    // Dropping the row looks the same on screen and loses the removal on the
    // way out: the save reconciles the payload against what is stored, so a row
    // the payload never mentions is kept. An unticked row for somebody nobody
    // dispatched carries no answer and is never written down.
    const onChange = vi.fn()
    render({
      rows: [person(), person({ personnel_id: 'c1', name: 'Koch René', on_board: false })],
      onChange,
    })
    const row = screen.getByText('Koch René').closest('div')
    await userEvent.click(within(row as HTMLElement).getByRole('button'))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ personnel_id: 'p1' }),
      expect.objectContaining({ personnel_id: 'c1', present: false, on_board: false }),
    ])
  })

  it('hides a removed row and offers the name again', async () => {
    render({
      rows: [person(), person({ personnel_id: 'c1', name: 'Koch René', present: false, on_board: false })],
      candidates: [candidate()],
    })
    expect(screen.queryByText('Koch René')).toBeNull()
    // …and the picker offers them again, or the removal could not be taken back.
    await userEvent.click(screen.getByRole('button', { name: 'Person hinzufügen' }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Koch René' })).toBeInTheDocument()
  })

  it('adds a typed name nobody has on a roster as a guest, without a note', async () => {
    const onExtraChange = vi.fn()
    render({ onExtraChange })

    await userEvent.click(screen.getByRole('button', { name: 'Person hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByPlaceholderText('Person suchen'), 'Bräm Urs')
    await userEvent.click(within(sheet).getByRole('button', { name: '«Bräm Urs» als Gast hinzufügen' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))

    expect(onExtraChange).toHaveBeenCalledWith([{ name: 'Bräm Urs', note: '' }])
  })

  it('still shows the note of a guest saved before the Notiz field went', () => {
    render({ extra: [{ name: 'Bräm Urs', note: 'FW Allschwil' }] })
    expect(screen.getByText('Bräm Urs')).toBeInTheDocument()
    expect(screen.getByText('FW Allschwil')).toBeInTheDocument()
    expect(screen.getByText('Gast')).toBeInTheDocument()
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
    const order = ['Heute angemeldet', 'Berger Nina', 'Graf Thomas', 'Alle', 'Ammann Lea', 'Suter Elias'].map(word =>
      text.indexOf(word),
    )
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('offers no controls in a read-only mount', () => {
    render({ disabled: true, extra: [{ name: 'Bräm Urs', note: '' }] })
    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Person hinzufügen' })).not.toBeInTheDocument()
  })
})

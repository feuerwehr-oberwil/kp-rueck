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
    render({ candidates: [candidate()], onChange })

    await userEvent.click(screen.getByRole('button', { name: /\(1\)/ }))
    await userEvent.click(screen.getByRole('button', { name: /Koch René/ }))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ personnel_id: 'p1' }),
      { personnel_id: 'c1', name: 'Koch René', present: true, on_board: false },
    ])
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

  it('hides a removed row and offers the name again', () => {
    render({
      rows: [person(), person({ personnel_id: 'c1', name: 'Koch René', present: false, on_board: false })],
      candidates: [candidate()],
    })
    expect(screen.queryByText('Koch René')).toBeNull()
    // …and the fold offers them again, or the removal could not be taken back.
    expect(screen.getByRole('button', { name: /\(1\)/ })).toBeInTheDocument()
  })

  it('takes a name and a note for somebody on no roster of this station', async () => {
    const onExtraChange = vi.fn()
    render({ onExtraChange })

    await userEvent.type(screen.getByPlaceholderText('Weitere Person (Name)'), 'Bräm Urs')
    await userEvent.type(screen.getByPlaceholderText(/FW Allschwil/), 'FW Allschwil, ab 21:00')
    await userEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))

    expect(onExtraChange).toHaveBeenCalledWith([{ name: 'Bräm Urs', note: 'FW Allschwil, ab 21:00' }])
  })

  it('folds the rest of the roster away and says how many are behind it', async () => {
    const candidates = Array.from({ length: 29 }, (_, i) =>
      candidate({ personnel_id: `x${i}`, name: `Angemeldet ${i}`, checked_in: true }),
    )
    render({ candidates })

    expect(screen.queryByRole('button', { name: /Angemeldet 7/ })).not.toBeInTheDocument()
    // The count is on screen unopened: an under-reported crew costs real money,
    // so the section never hides the fact that there is more to look at.
    await userEvent.click(screen.getByRole('button', { name: /\(29\)/ }))
    expect(screen.getByRole('button', { name: /Angemeldet 7/ })).toBeInTheDocument()
  })

  it('opens the roster by itself when the board dispatched nobody', () => {
    render({ rows: [], candidates: [candidate()] })
    // A closed fold over an empty section is a dead end.
    expect(screen.getByRole('button', { name: /Koch René/ })).toBeInTheDocument()
  })

  it('searches the whole roster without expanding it first', async () => {
    const candidates = [
      candidate({ personnel_id: 'c1', name: 'Graf Thomas', checked_in: true }),
      candidate({ personnel_id: 'c2', name: 'Suter Elias', checked_in: false }),
    ]
    render({ candidates })

    await userEvent.type(screen.getByPlaceholderText('Person suchen'), 'graf')
    expect(screen.getByRole('button', { name: /Graf Thomas/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Suter Elias/ })).not.toBeInTheDocument()
  })

  it('offers no controls in a read-only mount', () => {
    render({ disabled: true, extra: [{ name: 'Bräm Urs', note: '' }] })
    expect(screen.getByRole('checkbox', { name: /Muster Hans/ })).toBeDisabled()
    expect(screen.queryByPlaceholderText('Weitere Person (Name)')).not.toBeInTheDocument()
  })
})

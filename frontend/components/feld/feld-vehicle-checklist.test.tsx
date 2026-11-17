import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportVehicleCandidate, ApiRapportVehicleRow } from '@/lib/api/types'

import { FeldVehicleChecklist } from '@/components/feld/feld-vehicle-checklist'

function vehicle(overrides: Partial<ApiRapportVehicleRow> = {}): ApiRapportVehicleRow {
  return {
    vehicle_id: 'f1',
    name: 'TLF Oberwil',
    present: true,
    on_board: true,
    ...overrides,
  }
}

function candidate(overrides: Partial<ApiRapportVehicleCandidate> = {}): ApiRapportVehicleCandidate {
  return { vehicle_id: 'c1', name: 'ADL Oberwil', ...overrides }
}

function render(props: Partial<React.ComponentProps<typeof FeldVehicleChecklist>> = {}) {
  return renderWithIntl(
    <FeldVehicleChecklist rows={[vehicle()]} candidates={[]} onChange={vi.fn()} {...props} />,
  )
}

describe('FeldVehicleChecklist', () => {
  it('gives a row to the disponierten only — the fleet is not a checklist', () => {
    render({ rows: [vehicle()], candidates: [candidate()] })

    expect(screen.getByRole('checkbox', { name: /TLF Oberwil/ })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /ADL Oberwil/ })).not.toBeInTheDocument()
  })

  it('unticks exactly the row that was clicked', async () => {
    const onChange = vi.fn()
    render({ rows: [vehicle(), vehicle({ vehicle_id: 'f2', name: 'MTW Oberwil' })], onChange })

    await userEvent.click(screen.getByRole('checkbox', { name: /TLF Oberwil/ }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ vehicle_id: 'f1', present: false }),
      expect.objectContaining({ vehicle_id: 'f2', present: true }),
    ])
  })

  it('keeps an unticked disponiertes vehicle in place — a nein is a correction', () => {
    render({ rows: [vehicle({ present: false })] })
    expect(screen.getByRole('checkbox', { name: /TLF Oberwil/ })).not.toBeChecked()
  })

  it('adds a vehicle that came along without anybody disponierend it', async () => {
    const onChange = vi.fn()
    render({ candidates: [candidate()], onChange })

    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.click(within(sheet).getByRole('button', { name: 'ADL Oberwil' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ vehicle_id: 'f1' }),
      { vehicle_id: 'c1', name: 'ADL Oberwil', present: true, on_board: false },
    ])
  })

  it('takes an added vehicle back off the list by unticking, not by dropping it', async () => {
    // Same reason as in the Personal section: a row the payload never mentions
    // survives the save's reconciliation, so a dropped row is a lost removal.
    const onChange = vi.fn()
    render({
      rows: [vehicle(), vehicle({ vehicle_id: 'c1', name: 'ADL Oberwil', on_board: false })],
      onChange,
    })
    const row = screen.getByText('ADL Oberwil').closest('div')
    await userEvent.click(within(row as HTMLElement).getByRole('button'))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ vehicle_id: 'f1' }),
      expect.objectContaining({ vehicle_id: 'c1', present: false, on_board: false }),
    ])
  })

  it('hides a removed row and offers the vehicle again', async () => {
    render({
      rows: [vehicle(), vehicle({ vehicle_id: 'c1', name: 'ADL Oberwil', present: false, on_board: false })],
      candidates: [candidate()],
    })
    expect(screen.queryByText('ADL Oberwil')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'ADL Oberwil' })).toBeInTheDocument()
  })

  it('says so when the board disponiert nothing — and keeps the fleet folded', () => {
    // Unlike the Appell in the Personal section: "kein Fahrzeug" is a normal,
    // often correct answer for a Schadenplatz.
    render({ rows: [], candidates: [candidate()] })
    expect(screen.queryByRole('button', { name: 'ADL Oberwil' })).not.toBeInTheDocument()
  })

  it('does not offer a tick or the picker to a read-only mount', () => {
    render({ disabled: true, candidates: [candidate()] })
    expect(screen.getByRole('checkbox', { name: /TLF Oberwil/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Fahrzeug hinzufügen' })).not.toBeInTheDocument()
  })

  it('offers no typed vehicle: a rapport row is a fleet vehicle or nothing', async () => {
    render({ candidates: [candidate()] })
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByPlaceholderText('Fahrzeug suchen'), 'Pikett-Auto')
    expect(within(sheet).queryByRole('button', { name: /hinzufügen/ })).not.toBeInTheDocument()
    expect(within(sheet).getByText('Keine Treffer für «Pikett-Auto»')).toBeInTheDocument()
  })

  it('has no button when the whole fleet is already on the list', () => {
    render({ candidates: [] })
    expect(screen.queryByRole('button', { name: 'Fahrzeug hinzufügen' })).not.toBeInTheDocument()
  })
})

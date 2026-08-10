import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportVehicleRow } from '@/lib/api/types'

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

describe('FeldVehicleChecklist', () => {
  it('lists the dispatched vehicles ticked and the rest of the fleet unticked', () => {
    // §18.30: the whole fleet, because the board is behind reality in both
    // directions on a storm night.
    renderWithIntl(
      <FeldVehicleChecklist
        rows={[
          vehicle(),
          vehicle({ vehicle_id: 'f2', name: 'ADL Oberwil', present: false, on_board: false }),
        ]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: /TLF Oberwil/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /ADL Oberwil/ })).not.toBeChecked()
  })

  it('lets the crew tick a vehicle the board never sent', async () => {
    const onChange = vi.fn()
    renderWithIntl(
      <FeldVehicleChecklist
        rows={[vehicle({ vehicle_id: 'f2', name: 'ADL Oberwil', present: false, on_board: false })]}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /ADL Oberwil/ }))

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ vehicle_id: 'f2', present: true })])
  })

  it('unticks exactly the row that was clicked', async () => {
    const onChange = vi.fn()
    renderWithIntl(
      <FeldVehicleChecklist
        rows={[vehicle(), vehicle({ vehicle_id: 'f2', name: 'MTW Oberwil' })]}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /TLF Oberwil/ }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ vehicle_id: 'f1', present: false }),
      expect.objectContaining({ vehicle_id: 'f2', present: true }),
    ])
  })

  it('marks which rows the board actually dispatched', () => {
    renderWithIntl(
      <FeldVehicleChecklist
        rows={[vehicle(), vehicle({ vehicle_id: 'f2', name: 'ADL', present: false, on_board: false })]}
        onChange={vi.fn()}
      />,
    )
    // One badge, on the dispatched row only — otherwise the list reads as a
    // fleet inventory and the crew cannot see what it is correcting.
    expect(screen.getAllByText('disponiert')).toHaveLength(1)
  })

  it('says so when there is no fleet at all', () => {
    renderWithIntl(<FeldVehicleChecklist rows={[]} onChange={vi.fn()} />)
    expect(screen.getByText(/Keine Fahrzeuge erfasst/)).toBeInTheDocument()
  })

  it('does not offer a tick to a read-only mount', () => {
    renderWithIntl(<FeldVehicleChecklist rows={[vehicle()]} disabled onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /TLF Oberwil/ })).toBeDisabled()
  })
})

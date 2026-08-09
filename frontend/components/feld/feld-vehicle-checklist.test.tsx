import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportVehicleRow } from '@/lib/api/types'

import { FeldVehicleChecklist } from '@/components/feld/feld-vehicle-checklist'

function vehicle(overrides: Partial<ApiRapportVehicleRow> = {}): ApiRapportVehicleRow {
  return {
    assignment_id: 'v1',
    vehicle_id: 'f1',
    name: 'TLF Oberwil',
    present: true,
    on_board: true,
    ...overrides,
  }
}

describe('FeldVehicleChecklist', () => {
  it('lists the board vehicles all-ticked', () => {
    renderWithIntl(
      <FeldVehicleChecklist
        rows={[vehicle(), vehicle({ assignment_id: 'v2', name: 'MTW Oberwil' })]}
        onChange={vi.fn()}
      />,
    )

    const tlf = screen.getByRole('checkbox', { name: /TLF Oberwil/ })
    const mtw = screen.getByRole('checkbox', { name: /MTW Oberwil/ })
    // The board's list is the starting point — the crew strikes out what did
    // not roll, it does not retype the fleet.
    expect(tlf).toBeChecked()
    expect(mtw).toBeChecked()
  })

  it('unticks exactly the row that was clicked', async () => {
    const onChange = vi.fn()
    renderWithIntl(
      <FeldVehicleChecklist
        rows={[vehicle(), vehicle({ assignment_id: 'v2', name: 'MTW Oberwil' })]}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /TLF Oberwil/ }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ assignment_id: 'v1', present: false }),
      expect.objectContaining({ assignment_id: 'v2', present: true }),
    ])
  })

  it('keeps a vehicle the board dropped, marked as such', () => {
    renderWithIntl(
      <FeldVehicleChecklist rows={[vehicle({ on_board: false })]} onChange={vi.fn()} />,
    )
    expect(screen.getByText('Nicht mehr zugeteilt')).toBeInTheDocument()
  })

  it('says so when the incident has no vehicle at all', () => {
    renderWithIntl(<FeldVehicleChecklist rows={[]} onChange={vi.fn()} />)
    expect(screen.getByText(/Kein Fahrzeug erfasst/)).toBeInTheDocument()
  })

  it('does not offer a tick to a read-only mount', () => {
    renderWithIntl(<FeldVehicleChecklist rows={[vehicle()]} disabled onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: /TLF Oberwil/ })).toBeDisabled()
  })
})

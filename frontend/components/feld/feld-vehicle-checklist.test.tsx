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
  it('gives a chip to the disponierten only, with the driver beside the name', () => {
    render({ candidates: [candidate()], drivers: { f1: 'Dürring Jan' } })
    const list = screen.getByRole('list', { name: 'Fahrzeuge' })
    expect(within(list).getByText('Dürring Jan', { exact: false })).toBeInTheDocument()
    expect(within(list).getByText('TLF Oberwil', { exact: false })).toBeInTheDocument()
    expect(within(list).queryByText('ADL Oberwil')).toBeNull()
  })

  it('the ✕ unticks exactly that vehicle', async () => {
    const onChange = vi.fn()
    render({ rows: [vehicle(), vehicle({ vehicle_id: 'f2', name: 'Pio' })], onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Pio entfernen' }))
    expect(onChange).toHaveBeenCalledWith([
      vehicle(),
      { vehicle_id: 'f2', name: 'Pio', present: false, on_board: true },
    ])
  })

  it('offers a saved hand-added vehicle again after its ✕', async () => {
    // The server leaves a saved hand-added vehicle out of `candidates`; only the row knows it.
    render({ rows: [vehicle({ vehicle_id: 'h1', name: 'Pio', on_board: false, present: false })], candidates: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('button', { name: 'Pio' })).toBeInTheDocument()
  })

  it('offers a removed disponiertes vehicle again, ahead of the rest of the fleet', async () => {
    const onChange = vi.fn()
    render({ rows: [vehicle({ present: false })], candidates: [candidate()], onChange })
    expect(screen.queryByText('TLF Oberwil')).toBeNull()
    expect(screen.getByText('Kein Fahrzeug erfasst.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    const text = sheet.textContent ?? ''
    expect(text.indexOf('Disponiert')).toBeLessThan(text.indexOf('TLF Oberwil'))
    expect(text.indexOf('TLF Oberwil')).toBeLessThan(text.indexOf('ADL Oberwil'))
    await userEvent.click(within(sheet).getByRole('button', { name: 'TLF Oberwil' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))
    expect(onChange).toHaveBeenCalledWith([vehicle()])
  })

  it('adds a vehicle that came along without anybody disponierend it', async () => {
    const onChange = vi.fn()
    render({ candidates: [candidate()], onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.click(within(sheet).getByRole('button', { name: 'ADL Oberwil' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))
    expect(onChange).toHaveBeenCalledWith([
      vehicle(),
      { vehicle_id: 'c1', name: 'ADL Oberwil', present: true, on_board: false },
    ])
  })

  it('offers no typed vehicle: a rapport row is a fleet vehicle or nothing', async () => {
    render({ candidates: [candidate()] })
    await userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
    const sheet = await screen.findByRole('dialog')
    await userEvent.type(within(sheet).getByPlaceholderText('Fahrzeug suchen …'), 'Privatauto')
    expect(within(sheet).queryByRole('button', { name: /Privatauto/ })).toBeNull()
  })

  it('has no add chip when the whole fleet is already on the list, and none read-only', () => {
    const { unmount } = render({ candidates: [] })
    expect(screen.queryByRole('button', { name: 'Fahrzeug hinzufügen' })).toBeNull()
    unmount()
    render({ candidates: [candidate()], disabled: true })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

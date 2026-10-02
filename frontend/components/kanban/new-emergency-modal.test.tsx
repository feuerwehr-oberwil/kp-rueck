import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/**
 * "Telefonisch" (plan 26 §6 — the label lost its «gemeldet» when the toggle
 * gutter narrowed to match the input column; the full sentence lives on as the
 * row's hover title).
 *
 * The board's most-used modal takes one toggle, off by default, and what it
 * writes is the whole feature: an operator taking the call on the landline used
 * to produce a card that claimed to be operator-originated, which is the one
 * thing it is not. Off-by-default is asserted as its own case — a provenance
 * that defaults to "somebody phoned" would be the same lie in the other
 * direction, on every card typed at the KP.
 */

vi.mock('@/components/location/location-input', () => ({
  // The real field's id, invalid flag and description — what the modal's
  // inline message (#21) wires and a blocked submit focuses.
  LocationInput: ({
    address,
    onAddressChange,
    error,
    describedBy,
  }: {
    address: string
    onAddressChange: (v: string) => void
    error?: boolean
    describedBy?: string
  }) => (
    <input
      id="location_address"
      aria-label="Ort"
      aria-invalid={error}
      aria-describedby={describedBy}
      value={address}
      onChange={(e) => onAddressChange(e.target.value)}
    />
  ),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import { NewEmergencyModal } from '@/components/kanban/new-emergency-modal'

function renderModal() {
  const onCreateOperation = vi.fn()
  renderWithIntl(
    <NewEmergencyModal open onOpenChange={() => {}} onCreateOperation={onCreateOperation} />,
  )
  return { onCreateOperation }
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
  await user.click(screen.getByRole('button', { name: /erfassen|erstellen/i }))
}

describe('NewEmergencyModal — Telefonisch', () => {
  it('is off by default: typing a card on the board IS the operator case', async () => {
    const user = userEvent.setup()
    const { onCreateOperation } = renderModal()

    expect(screen.getByRole('switch', { name: 'Telefonisch' })).not.toBeChecked()

    await submit(user)
    expect(onCreateOperation).toHaveBeenCalledWith(expect.objectContaining({ source: 'operator' }))
  })

  it('writes source=intake once the operator says it was a call', async () => {
    const user = userEvent.setup()
    const { onCreateOperation } = renderModal()

    await user.click(screen.getByRole('switch', { name: 'Telefonisch' }))
    expect(screen.getByRole('switch', { name: 'Telefonisch' })).toBeChecked()

    await submit(user)
    expect(onCreateOperation).toHaveBeenCalledWith(expect.objectContaining({ source: 'intake' }))
  })

  it('toggles back off — a mis-clicked claim is corrected, not lived with', async () => {
    const user = userEvent.setup()
    const { onCreateOperation } = renderModal()

    const toggle = screen.getByRole('switch', { name: 'Telefonisch' })
    await user.click(toggle)
    await user.click(toggle)
    expect(toggle).not.toBeChecked()

    await submit(user)
    expect(onCreateOperation).toHaveBeenCalledWith(expect.objectContaining({ source: 'operator' }))
  })

  it('sits with Kontakt/Melder and Telefon, not at the top of the form', () => {
    renderModal()

    const fields = screen.getAllByText(/^Telefonisch$|Kontakt \/ Melder|Telefonnummer/)
    expect(fields.map((node) => node.textContent)).toEqual([
      'Telefonisch',
      'Kontakt / Melder',
      'Telefonnummer',
    ])
  })
})

/**
 * Der Aktionsblock stand hier als einziger Dialog der App andersherum:
 * Primärbutton links, Abbrechen rechts. Auf dem meistgenutzten Modal des Boards
 * kostet genau das am meisten — die Hand geht dorthin, wo sie überall sonst
 * hingeht.
 */
describe('NewEmergencyModal — Aktionsreihenfolge', () => {
  it('stellt Abbrechen vor den Primärbutton, wie jeder andere Dialog', () => {
    renderModal()

    const footer = document.querySelector('[data-slot="dialog-footer"]')
    expect(footer).not.toBeNull()

    const labels = Array.from(footer!.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toEqual(['Abbrechen', 'Einsatz erstellen'])
  })
})

/**
 * Messages under the field (#21): red blocks, amber advises. «Einsatz erstellen»
 * is never greyed out for a missing Ort any more — a press says what is missing
 * and puts the cursor there. No toast.
 */
describe('NewEmergencyModal — Meldungen im Formular', () => {
  it('a press without Einsatzort says why, under the field, and focuses it', async () => {
    const user = userEvent.setup()
    const { onCreateOperation } = renderModal()

    const create = screen.getByRole('button', { name: 'Einsatz erstellen' })
    expect(create).toBeEnabled()
    await user.click(create)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Einsatzort fehlt – ohne Ort lässt sich der Einsatz nicht erstellen.')
    const ort = screen.getByLabelText('Ort')
    expect(ort).toHaveFocus()
    expect(ort).toHaveAttribute('aria-invalid', 'true')
    expect(ort).toHaveAccessibleDescription(alert.textContent!)
    expect(onCreateOperation).not.toHaveBeenCalled()
  })

  it('advises on a short phone number once the field is left — and creates anyway', async () => {
    const user = userEvent.setup()
    const { onCreateOperation } = renderModal()

    const phone = screen.getByLabelText('Telefonnummer')
    await user.type(phone, '079 123 45')
    // Still typing: a number being typed is not a wrong number.
    expect(screen.queryByRole('status')).toBeNull()

    await user.tab()
    const advice = screen.getByRole('status')
    expect(advice.textContent).toBe('Nummer hat nur 8 Ziffern – bitte prüfen. Erstellen geht trotzdem.')
    expect(phone).toHaveAccessibleDescription(advice.textContent!)
    expect(phone).not.toHaveAttribute('aria-invalid')

    await submit(user)
    expect(onCreateOperation).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: '079 123 45' }))
  })

  it('says nothing about a complete number', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.type(screen.getByLabelText('Telefonnummer'), '079 123 45 67')
    await user.tab()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

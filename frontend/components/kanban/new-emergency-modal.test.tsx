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
// Desktop (the centred dialog) unless a test says phone — jsdom has no matchMedia.
const viewport = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => viewport.mobile }))

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

    const buttons = Array.from(footer!.querySelectorAll('button'))
    expect(buttons.slice(0, 2).map((b) => b.textContent?.trim())).toEqual(['Abbrechen', 'Einsatz erstellen'])
    // the arrow of the split button sits last, glued to the primary
    expect(buttons[2]).toHaveAccessibleName('Weitere Aktionen')
  })
})

/**
 * TWO WAYS OUT: the arrow beside «Einsatz erstellen» and Ctrl ↵ create the card
 * and keep the dialog open, emptied, for the next call. The pick of 2026-10-20:
 * a split button, for the few who look for it, never a second button to confuse.
 */
describe('NewEmergencyModal — Erstellen und nächsten erfassen', () => {
  function renderOpenTracking() {
    const onCreateOperation = vi.fn()
    const onOpenChange = vi.fn()
    renderWithIntl(
      <NewEmergencyModal open onOpenChange={onOpenChange} onCreateOperation={onCreateOperation} />,
    )
    return { onCreateOperation, onOpenChange }
  }

  it('the menu item creates, keeps the dialog open and empties the form', async () => {
    const user = userEvent.setup()
    const { onCreateOperation, onOpenChange } = renderOpenTracking()

    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12')
    await user.type(screen.getByLabelText('Meldung'), 'Wasser im Keller')
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }))
    await user.click(await screen.findByRole('menuitem', { name: /nächsten erfassen/ }))

    expect(onCreateOperation).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'Hauptstrasse 12', notes: 'Wasser im Keller' }),
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByLabelText('Ort')).toHaveValue('')
    expect(screen.getByLabelText('Meldung')).toHaveValue('')
    expect(screen.getByLabelText('Ort')).toHaveFocus()
  })

  it('Ctrl+Enter is the same way out, and Telefonisch carries over into the next card', async () => {
    const user = userEvent.setup()
    const { onCreateOperation, onOpenChange } = renderOpenTracking()

    await user.click(screen.getByRole('switch', { name: 'Telefonisch' }))
    await user.type(screen.getByLabelText('Ort'), 'Bahnhofstrasse 4{Control>}{Enter}{/Control}')

    expect(onCreateOperation).toHaveBeenCalledTimes(1)
    expect(onCreateOperation).toHaveBeenCalledWith(expect.objectContaining({ source: 'intake' }))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByLabelText('Ort')).toHaveValue('')
    expect(screen.getByRole('switch', { name: 'Telefonisch' })).toBeChecked()
  })

  it('without an Einsatzort it refuses like the primary does', async () => {
    const user = userEvent.setup()
    const { onCreateOperation } = renderOpenTracking()

    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }))
    await user.click(await screen.findByRole('menuitem', { name: /nächsten erfassen/ }))

    expect(onCreateOperation).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Ort')).toHaveFocus()
  })

  it('a plain Enter in the form does not create', async () => {
    const user = userEvent.setup()
    const { onCreateOperation } = renderOpenTracking()
    await user.type(screen.getByLabelText('Ort'), 'Hauptstrasse 12{Enter}')
    expect(onCreateOperation).not.toHaveBeenCalled()
  })
})

// UX-DESKTOP-03: «Abbrechen» is «throw it away» – the modal stays mounted, so without a
// reset the next «Neuer Einsatz» opened with the cancelled call in it.
describe('NewEmergencyModal — Abbrechen', () => {
  it('empties the form, so the next open starts blank', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderWithIntl(<NewEmergencyModal open onOpenChange={onOpenChange} onCreateOperation={vi.fn()} />)

    await user.type(screen.getByLabelText('Ort'), 'Abgebrochener Anruf 1')
    await user.type(screen.getByLabelText('Meldung'), 'Doch nichts')
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByLabelText('Ort')).toHaveValue('')
    expect(screen.getByLabelText('Meldung')).toHaveValue('')
  })
})

describe('NewEmergencyModal — Handy', () => {
  it('asks before a swipe or ✕ throws away what was typed; «Verwerfen» empties and closes', async () => {
    viewport.mobile = true
    try {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      renderWithIntl(<NewEmergencyModal open onOpenChange={onOpenChange} onCreateOperation={vi.fn()} />)
      await user.type(screen.getByLabelText('Meldung'), 'Keller unter Wasser')
      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(onOpenChange).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Verwerfen' }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(screen.getByLabelText('Meldung')).toHaveValue('')
    } finally {
      viewport.mobile = false
    }
  })

  it('closes without asking when nothing was typed', async () => {
    viewport.mobile = true
    try {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      renderWithIntl(<NewEmergencyModal open onOpenChange={onOpenChange} onCreateOperation={vi.fn()} />)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(screen.queryByRole('alertdialog')).toBeNull()
    } finally {
      viewport.mobile = false
    }
  })

  it('does not promise drag & drop on the phone, where there is none', () => {
    viewport.mobile = true
    try {
      renderModal()
      expect(screen.queryByText(/Drag & Drop/)).toBeNull()
    } finally {
      viewport.mobile = false
    }
  })

  it('is a bottom sheet on the keyboard edge with its actions in a footer that stays', () => {
    viewport.mobile = true
    try {
      renderModal()
      const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!
      expect(sheet).toHaveAttribute('data-side', 'bottom')
      // geometry comes from the keyboard rule in globals.css, not an inline bottom
      expect(sheet.style.bottom).toBe('')
      // no keyboard on open: nothing but the sheet holds focus
      expect(screen.getByLabelText('Ort')).not.toHaveFocus()
      // the phone keyboard offers no contact card on the Melder fields
      expect(screen.getByLabelText('Meldung')).toHaveAttribute('autocomplete', 'off')
      expect(screen.getByLabelText('Kontakt / Melder')).toHaveAttribute('autocomplete', 'off')
      // the rows scroll on their own; the footer is outside that scroller
      const body = sheet.querySelector('[data-slot="sheet-body"]')!
      expect(body).toContainElement(screen.getByLabelText('Ort'))
      const footer = sheet.querySelector<HTMLElement>('[data-slot="sheet-footer"]')!
      expect(body).not.toContainElement(footer)
      const buttons = Array.from(footer.querySelectorAll('button')).map((b) => b.textContent?.trim())
      expect(buttons[0]).toMatch(/Abbrechen/)
      expect(buttons[1]).toMatch(/erstellen/)
      expect(sheet.querySelector('[data-slot="sheet-grip"]')).not.toBeNull()
      // labels ABOVE the fields on the phone: the label is its own block, the control below it
      const meldung = screen.getByText('Meldung', { selector: 'label' })
      expect(meldung.closest('[data-stacked]')).not.toBeNull()
      expect(meldung.nextElementSibling).toContainElement(screen.getByLabelText('Meldung'))
      // switches: label left, switch right, one row
      const tel = screen.getByRole('switch', { name: 'Telefonisch' })
      expect(tel.closest('.min-h-11')).toHaveTextContent('Telefonisch')
    } finally {
      viewport.mobile = false
    }
  })

  it('in the sheet too, a press without Einsatzort says why under the field and focuses it', async () => {
    viewport.mobile = true
    try {
      const user = userEvent.setup()
      const { onCreateOperation } = renderModal()
      const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!
      const footer = sheet.querySelector<HTMLElement>('[data-slot="sheet-footer"]')!
      const create = Array.from(footer.querySelectorAll('button')).find((b) => /erstellen/.test(b.textContent ?? ''))!
      expect(create).toBeEnabled()
      await user.click(create)

      const alert = screen.getByRole('alert')
      expect(sheet.querySelector('[data-slot="sheet-body"]')).toContainElement(alert)
      expect(screen.getByLabelText('Ort')).toHaveFocus()
      expect(onCreateOperation).not.toHaveBeenCalled()
    } finally {
      viewport.mobile = false
    }
  })

  it('in the sheet, the phone advice stands full width under the stacked field and is wired to it', async () => {
    viewport.mobile = true
    try {
      const user = userEvent.setup()
      renderModal()
      const phone = screen.getByLabelText('Telefonnummer')
      await user.type(phone, '079 123 45')
      await user.tab()
      const advice = screen.getByRole('status')
      expect(phone).toHaveAccessibleDescription(advice.textContent!)
      // inside the stacked field, so it takes the full width, not the desktop label indent
      expect(advice.closest('[data-stacked]')).not.toBeNull()
    } finally {
      viewport.mobile = false
    }
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

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { type Choice, ChoiceDialog } from '@/components/ui/choice-dialog'

const choice = (shortcut: string, label: string): Choice => ({
  shortcut,
  label,
  icon: null,
  diagram: null,
  consequence: `${label} – Folge`,
  onSelect: vi.fn(),
})

describe('ChoiceDialog', () => {
  // Sol review E round 3: on a short screen the stacked cards pushed Abbrechen off-screen. The
  // height cap and the scroll itself are geometry jsdom cannot measure; the structure it can.
  it('scrolls only the cards: title and Abbrechen stay outside the scroller', () => {
    renderWithIntl(
      <ChoiceDialog
        title="Doppelbelegung"
        description="TLF ist schon im Einsatz."
        choices={[choice('v', 'Hierher verschieben'), choice('b', 'Auf beiden führen')]}
        onCancel={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveClass('modal-h-tall')
    const cards = dialog.querySelector('[data-slot="choice-cards"]')
    expect(cards).toHaveClass('overflow-y-auto', 'min-h-0')
    expect(cards).toContainElement(screen.getByRole('button', { name: 'Hierher verschieben' }))
    expect(cards).not.toContainElement(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(cards).not.toContainElement(screen.getByText('Doppelbelegung'))
  })

  // Sign-off 24.11.2026: the outline Cancel's `dark:bg-input/30` survived under the ink class –
  // dark text on a dark fill. Abbrechen is the plain ink button in both themes.
  it('draws Abbrechen as the ink main button, without the outline variant\'s dark fill', () => {
    renderWithIntl(
      <ChoiceDialog
        title="Doppelbelegung"
        description="TLF ist schon im Einsatz."
        choices={[choice('v', 'Hierher verschieben'), choice('b', 'Auf beiden führen')]}
        onCancel={vi.fn()}
      />,
    )

    const cancel = screen.getByRole('button', { name: /Abbrechen/ })
    expect(cancel).toHaveClass('bg-action', 'text-action-foreground')
    expect(cancel.className).not.toMatch(/dark:bg-input/)
  })
})

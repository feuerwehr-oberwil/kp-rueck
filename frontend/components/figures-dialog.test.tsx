import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { onIncidentHighlight, type IncidentHighlightOptions } from '@/lib/notification-highlight'

/**
 * The oldest waiting «Hoch» in Kennzahlen opens that Einsatz on Übersicht. A bare highlight
 * request opens nothing on a narrow screen (`allowModal`): on the phone that left the row a dead
 * button, and a 1280px desk only got a ring on the card (TAB.11). So it always allows the modal;
 * the board still picks the side panel on a wide desk.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({ selectedEvent: { id: 'e1', name: 'Sturm Ost', training_flag: false } }),
}))
vi.mock('@/components/event-figures', () => ({
  EventFiguresPanel: ({ onOpenIncident }: { onOpenIncident: (id: string) => void }) => (
    <button type="button" onClick={() => onOpenIncident('incident-7')}>Älteste Hoch</button>
  ),
}))

import { FiguresDialog, toggleFigures } from '@/components/figures-dialog'

const width = window.innerWidth
afterEach(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }))

async function openOldestHoch(viewportWidth: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth })
  const requests: [string, IncidentHighlightOptions][] = []
  const stop = onIncidentHighlight((id, options) => requests.push([id, options]))
  renderWithIntl(<FiguresDialog />)
  act(() => toggleFigures())
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Älteste Hoch' }))
  stop()
  return requests
}

describe('Kennzahlen › the oldest «Hoch» opens its Einsatz', () => {
  it('on the phone: as its Einsatz sheet, and the dialog makes way', async () => {
    expect(await openOldestHoch(393)).toEqual([['incident-7', { tab: 'overview', allowModal: true }]])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // After-shots 14.11.2026: a centred dialog with the title wrapping beside a ✕ that wore a
  // focus ring from the first frame. The phone gets the bottom sheet, focus on the sheet.
  it('opens on the phone as a bottom sheet with nothing focused inside it', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 })
    renderWithIntl(<FiguresDialog />)
    act(() => toggleFigures())
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveAttribute('data-slot', 'sheet-content')
    expect(screen.getByText('Sturm Ost')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(sheet))
  })

  it('stays a dialog on the desk', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    renderWithIntl(<FiguresDialog />)
    act(() => toggleFigures())
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-slot', 'dialog-content')
  })

  it('on a narrow desk: the detail opens too (the modal), not only a ring', async () => {
    expect(await openOldestHoch(1280)).toEqual([['incident-7', { tab: 'overview', allowModal: true }]])
  })
})

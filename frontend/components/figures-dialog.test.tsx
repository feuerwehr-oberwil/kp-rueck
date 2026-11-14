import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { onIncidentHighlight, type IncidentHighlightOptions } from '@/lib/notification-highlight'

/**
 * The oldest waiting «Hoch» in Kennzahlen opens that Einsatz. On the phone that has to be its
 * Einsatz sheet: a bare highlight request opens nothing on a narrow screen (`allowModal`), which
 * left the row a dead button there. The desk keeps the side panel it always got.
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
    expect(await openOldestHoch(393)).toEqual([['incident-7', { tab: undefined, allowModal: true }]])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('on the desk: the highlight it always was (side panel, never a modal)', async () => {
    expect(await openOldestHoch(1440)).toEqual([['incident-7', { tab: undefined, allowModal: false }]])
  })
})

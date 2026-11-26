import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'

/** The phone list's empty states (#3): a search that found nothing gets its
 *  own sentence and «Suche leeren»; a status filter that hides everything says
 *  which, and «Alle zeigen». Plus the funnel filter menu and the footer action. */

vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ groups: [] }) }))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ refreshOperations: vi.fn() }) }))
// The pill is its own component (phone-event-pill.test.tsx); here only where it stands.
vi.mock('@/components/mobile/phone-event-pill', () => ({
  PhoneEventPill: () => <button type="button">Ereignis-Pill</button>,
  ViewOnlyTag: () => null,
}))
vi.mock('@/components/mobile/mobile-incident-card', () => ({
  MobileIncidentCard: ({ operation }: { operation: Operation }) => <div data-testid="card">{operation.location}</div>,
}))
vi.mock('@/components/mobile/mobile-incident-detail-sheet', () => ({
  MobileIncidentDetailSheet: ({ operation, open }: { operation: Operation | null; open: boolean }) =>
    open && operation ? <div data-testid="phone-sheet">{operation.location}</div> : null,
}))

import { MobileIncidentListView } from '@/components/mobile/mobile-incident-list-view'
import { makeOperation } from '@/test-utils/operation-fixtures'

const op = (id: string, location: string, status: Operation['status'], notes = '') =>
  makeOperation({
    id,
    location,
    status,
    notes,
    dispatchTime: new Date('2026-10-02T10:00:00Z'),
  })

function renderList() {
  return renderWithIntl(
    <MobileIncidentListView
      operations={[op('1', 'Hauptstrasse 41', 'incoming'), op('2', 'Langegasse 97', 'incoming')]}
      materials={[]}
      formatLocation={(a) => a}
    />,
  )
}

describe('MobileIncidentListView — empty states', () => {
  it('search without hits: «Keine Treffer für «xyz»» and «Suche leeren» brings the list back', async () => {
    const user = userEvent.setup()
    renderList()

    const field = screen.getByPlaceholderText('Einsatz suchen …')
    await user.type(field, 'xyz')

    const empty = screen.getByRole('status')
    expect(within(empty).getByText('Keine Treffer für «xyz»')).toBeDefined()
    await user.click(within(empty).getByRole('button', { name: 'Suche leeren' }))

    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(screen.getAllByTestId('card')).toHaveLength(2)
  })

  it('a status filter that hides everything says which, and «Alle zeigen» lifts it', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Filtern' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /^Im Einsatz/ }))
    await user.keyboard('{Escape}')
    const empty = screen.getByRole('status')
    expect(empty.textContent).toContain('Keine Einsätze mit Status «Im Einsatz»')

    await user.click(within(empty).getByRole('button', { name: 'Alle zeigen' }))
    expect(screen.getAllByTestId('card')).toHaveLength(2)
  })
})

function renderBare(props: Partial<React.ComponentProps<typeof MobileIncidentListView>> = {}) {
  return renderWithIntl(
    <MobileIncidentListView operations={[]} materials={[]} formatLocation={(a) => a} {...props} />,
  )
}

describe('MobileIncidentListView — the search', () => {
  it('finds an Einsatz by its Meldung — the board matcher, not a phone copy', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <MobileIncidentListView
        operations={[
          op('1', 'Bahnhofstrasse 22', 'incoming', 'Unterführung nach Starkregen überflutet'),
          op('2', 'Langegasse 97', 'incoming'),
        ]}
        materials={[]}
        formatLocation={(a) => a}
      />,
    )
    await user.type(screen.getByPlaceholderText('Einsatz suchen …'), 'unterführung')
    expect(screen.getAllByTestId('card').map((card) => card.textContent)).toEqual(['Bahnhofstrasse 22'])
  })
})

describe('MobileIncidentListView — «Neuer Einsatz» in the footer', () => {
  it('gives the phone a visible way in that opens the form', async () => {
    const onNewIncident = vi.fn()
    renderBare({ isEditor: true, onNewIncident })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Neuer Einsatz' }))
    expect(onNewIncident).toHaveBeenCalledOnce()
  })

  it('is not there without the handler (viewers): no footer at all', () => {
    renderBare({ isEditor: false })
    expect(screen.queryByRole('button', { name: 'Neuer Einsatz' })).toBeNull()
  })

  it('stands at the END, after the list — one action, below the cards', () => {
    renderWithIntl(
      <MobileIncidentListView
        operations={[op('1', 'Hauptstrasse 41', 'incoming')]}
        materials={[]}
        formatLocation={(a) => a}
        isEditor
        onNewIncident={() => {}}
      />,
    )
    const neu = screen.getByRole('button', { name: 'Neuer Einsatz' })
    const card = screen.getByTestId('card')
    expect(card.compareDocumentPosition(neu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Neuer Einsatz/ })).toHaveLength(1)
  })

  // Owner pick 5B (phone sweep 24.11.2026): one split button in the footer, the head keeps the list.
  it('in an Übung «Neuer Einsatz» is one half of the footer, the Übung menu the other', async () => {
    const onNewIncident = vi.fn()
    renderBare({ isEditor: true, isTraining: true, onNewIncident })
    const search = screen.getByPlaceholderText('Einsatz suchen …')
    const menu = screen.getByRole('button', { name: 'Übungs-Einsatz auslösen' })
    expect(search.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ereignis-Pill' }).compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Neuer Einsatz' }))
    expect(onNewIncident).toHaveBeenCalledOnce()
  })
})

describe('MobileIncidentListView — the funnel filter', () => {
  const ops = [
    op('1', 'Hauptstrasse 41', 'active'),
    op('2', 'Langegasse 97', 'enroute'),
    op('3', 'Kirchgasse 3', 'incoming'),
    op('4', 'Grenzweg 7', 'reko'),
    op('5', 'Hauptstrasse 9', 'returning'),
    op('6', 'Schulstrasse 6', 'complete'),
  ]
  const renderOps = () =>
    renderWithIntl(<MobileIncidentListView operations={ops} materials={[]} formatLocation={(a) => a} />)
  const funnel = () => screen.getByRole('button', { name: /^Filtern/ })
  const row = (name: RegExp) => screen.findByRole('menuitemcheckbox', { name })

  it('replaces the chip row: one search field and one funnel, no status pills', () => {
    renderOps()
    expect(funnel()).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Alle \(/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Im Einsatz/ })).toBeNull()
  })

  it('lists every status with its count, nothing ticked, no «Alle zeigen» yet', async () => {
    const user = userEvent.setup()
    renderOps()
    await user.click(funnel())
    // One row per status now, so each count is that status alone.
    expect((await row(/^Im Einsatz/)).textContent).toContain('1')
    expect((await row(/^Disponiert/)).textContent).toContain('1')
    expect((await row(/^Eingegangen/)).textContent).toContain('1')
    // «Reko» alone, not «Reko abgeschlossen», which also starts with it.
    expect((await row(/^Reko(?! abgeschlossen)/)).textContent).toContain('1')
    expect((await row(/^Rückfahrt/)).textContent).toContain('1')
    expect((await row(/^Abgeschlossen/)).textContent).toContain('1')
    for (const r of screen.getAllByRole('menuitemcheckbox')) expect(r).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('menuitem', { name: /Alle zeigen/ })).toBeNull()
  })

  it('ticks several groups (the menu stays open), shows their union and names them on the funnel', async () => {
    const user = userEvent.setup()
    renderOps()
    await user.click(funnel())
    await user.click(await row(/^Disponiert/))
    await user.click(await row(/^Im Einsatz/))
    await user.click(await row(/^Rückfahrt/))
    expect(await row(/^Im Einsatz/)).toHaveAttribute('aria-checked', 'true')
    expect(await row(/^Rückfahrt/)).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Escape}')

    expect(screen.getAllByTestId('card').map((c) => c.textContent).sort()).toEqual(
      ['Hauptstrasse 41', 'Hauptstrasse 9', 'Langegasse 97'],
    )
    // Named in board order, not in the order they were ticked – the same words as the line below.
    expect(funnel()).toHaveAttribute('aria-label', 'Filtern – Gefiltert: Disponiert / Anfahrt · Im Einsatz · Rückfahrt')
    expect(funnel().className).toContain('bg-sel-wash')
    expect(screen.getByTestId('filter-summary').textContent).toContain('Gefiltert: Disponiert / Anfahrt · Im Einsatz · Rückfahrt')
  })

  it('«Alle zeigen» stands first while something is ticked, with the total, and clears every tick', async () => {
    const user = userEvent.setup()
    renderOps()
    await user.click(funnel())
    await user.click(await row(/^Eingegangen/))
    const items = screen.getAllByRole('menuitem')
    expect(items[0].textContent).toContain('Alle zeigen')
    expect(items[0].textContent).toContain('6')
    await user.click(items[0])

    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getAllByTestId('card')).toHaveLength(6)
    expect(funnel()).toHaveAttribute('aria-label', 'Filtern')
    expect(funnel().className).not.toContain('bg-sel-wash')
    expect(screen.queryByTestId('filter-summary')).toBeNull()
  })

  it('counts under the search: a row says what ticking it would show', async () => {
    const user = userEvent.setup()
    renderOps()
    await user.type(screen.getByPlaceholderText('Einsatz suchen …'), 'Hauptstrasse')
    await user.click(funnel())
    expect((await row(/^Im Einsatz/)).textContent).toContain('1')
    expect((await row(/^Rückfahrt/)).textContent).toContain('1')
    expect((await row(/^Eingegangen/)).textContent).toContain('0')
  })
})

describe('MobileIncidentListView — «Sortieren» in the funnel', () => {
  afterEach(() => localStorage.clear())
  // 1 alarmed first but moved to Im Einsatz at 10:50 · 2 alarmed last · 3 Eingegangen since 10:10
  const ops = [
    { ...op('1', 'Hauptstrasse 41', 'active'), dispatchTime: new Date('2026-11-14T10:00:00Z'), statusChangedAt: new Date('2026-11-14T10:50:00Z') },
    { ...op('2', 'Langegasse 97', 'incoming'), dispatchTime: new Date('2026-11-14T10:40:00Z') },
    { ...op('3', 'Kirchgasse 3', 'incoming'), dispatchTime: new Date('2026-11-14T10:10:00Z') },
  ] as Operation[]
  const renderOps = () =>
    renderWithIntl(<MobileIncidentListView operations={ops} materials={[]} formatLocation={(a) => a} />)
  const funnel = () => screen.getByRole('button', { name: /^Filtern/ })
  const cards = () => screen.getAllByTestId('card').map((c) => c.textContent)

  it('starts on «Status» – the order the list always had – with the funnel off', async () => {
    const user = userEvent.setup()
    renderOps()
    expect(cards()).toEqual(['Hauptstrasse 41', 'Langegasse 97', 'Kirchgasse 3'])
    expect(funnel().className).not.toContain('bg-sel-wash')
    expect(screen.queryByTestId('filter-summary')).toBeNull()
    await user.click(funnel())
    expect(await screen.findByRole('menuitemradio', { name: 'Status' })).toHaveAttribute('aria-checked', 'true')
  })

  it('another order turns the funnel on and says so under the search, together with a filter', async () => {
    const user = userEvent.setup()
    renderOps()
    await user.click(funnel())
    await user.click(await screen.findByRole('menuitemradio', { name: 'Längste Wartezeit' }))
    // the menu stays open, like a tick
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /^Eingegangen/ }))
    await user.keyboard('{Escape}')

    expect(cards()).toEqual(['Kirchgasse 3', 'Langegasse 97'])
    expect(funnel().className).toContain('bg-sel-wash')
    expect(screen.getByTestId('filter-summary').textContent).toContain('Sortiert: Längste Wartezeit · Gefiltert: Eingegangen')
    expect(funnel()).toHaveAttribute('aria-label', 'Filtern – Sortiert: Längste Wartezeit · Gefiltert: Eingegangen')
  })

  it('is remembered on this device', async () => {
    const user = userEvent.setup()
    const first = renderOps()
    await user.click(funnel())
    await user.click(await screen.findByRole('menuitemradio', { name: 'Neueste zuerst' }))
    await user.keyboard('{Escape}')
    first.unmount()

    renderOps()
    expect(cards()).toEqual(['Langegasse 97', 'Kirchgasse 3', 'Hauptstrasse 41'])
    expect(screen.getByTestId('filter-summary').textContent).toBe('Sortiert: Neueste zuerst')
  })
})

describe('MobileIncidentListView — opened from outside (notification, ?detail=1)', () => {
  it('an open request opens the phone Einsatz sheet of that incident', () => {
    const operations = [op('1', 'Hauptstrasse 41', 'incoming'), op('2', 'Langegasse 97', 'incoming')]
    const { rerender } = renderWithIntl(
      <MobileIncidentListView operations={operations} materials={[]} formatLocation={(a) => a} />,
    )
    expect(screen.queryByTestId('phone-sheet')).toBeNull()
    rerender(
      <MobileIncidentListView
        operations={operations}
        materials={[]}
        formatLocation={(a) => a}
        openRequest={{ incidentId: '2', nonce: 1 }}
      />,
    )
    expect(screen.getByTestId('phone-sheet').textContent).toBe('Langegasse 97')
  })
})

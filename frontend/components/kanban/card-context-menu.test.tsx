import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { Operation } from '@/lib/contexts/operations-context'

vi.mock('@/lib/hooks/use-print-assignment-slip', () => ({
  usePrintAssignmentSlip: () => ({ print: vi.fn(), printing: false }),
}))
const writes = vi.hoisted(() => ({ saveRekoArrived: vi.fn(), saveFieldReport: vi.fn() }))
vi.mock('@/lib/hooks/use-field-report-writes', () => ({ useFieldReportWrites: () => writes }))

import { CardContextMenu } from '@/components/kanban/card-context-menu'

function openMenu(status: Operation['status'], onRepeatRadio = vi.fn()) {
  const operation = { id: 'op-1', status, nachbarhilfe: false, amWarten: false } as Operation
  renderWithIntl(
    <ContextMenu>
      <ContextMenuTrigger>Karte</ContextMenuTrigger>
      <CardContextMenu operation={operation} onEdit={vi.fn()} onRepeatRadio={onRepeatRadio} />
    </ContextMenu>,
  )
  fireEvent.contextMenu(screen.getByText('Karte'))
  return onRepeatRadio
}

// #11: the Funkdurchsage of a single Einsatz can be read out again once it is out.
describe('CardContextMenu «Funkdurchsage wiederholen»', () => {
  it('offers it from «Disponiert» on and opens the repeat', async () => {
    const onRepeatRadio = openMenu('enroute')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Funkdurchsage wiederholen' }))
    expect(onRepeatRadio).toHaveBeenCalledOnce()
  })

  it('does not offer it before anybody was sent', async () => {
    openMenu('incoming')
    await screen.findByRole('menuitem', { name: 'Bearbeiten' })
    expect(screen.queryByRole('menuitem', { name: 'Funkdurchsage wiederholen' })).toBeNull()
  })
})

// Sign-off 24.11.2026: a closed Einsatz is not considered for anything new – no Auftrag either.
describe('CardContextMenu «An Auftrag verteilen»', () => {
  function openWithDistribute(status: Operation['status']) {
    const operation = { id: 'op-1', status, nachbarhilfe: false, amWarten: false, groupId: null } as Operation
    renderWithIntl(
      <ContextMenu>
        <ContextMenuTrigger>Karte</ContextMenuTrigger>
        <CardContextMenu operation={operation} onEdit={vi.fn()} onDistributeToAuftrag={vi.fn()} />
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('Karte'))
  }

  it('offers it on an open Einsatz', async () => {
    openWithDistribute('active')
    expect(await screen.findByRole('menuitem', { name: 'An Auftrag verteilen' })).toBeDefined()
  })

  it('does not offer it on a closed Einsatz', async () => {
    openWithDistribute('complete')
    await screen.findByRole('menuitem', { name: 'Bearbeiten' })
    expect(screen.queryByRole('menuitem', { name: 'An Auftrag verteilen' })).toBeNull()
  })
})

// Owner pick 4A (24.11.2026): the two radio facts straight from the card.
describe('CardContextMenu Funkmeldungen', () => {
  function openWith(overrides: Partial<Operation>, canReport = true) {
    writes.saveRekoArrived.mockClear()
    writes.saveFieldReport.mockClear()
    const operation = { id: 'op-1', status: 'reko', nachbarhilfe: false, amWarten: false, ...overrides } as Operation
    renderWithIntl(
      <ContextMenu>
        <ContextMenuTrigger>Karte</ContextMenuTrigger>
        <CardContextMenu operation={operation} onEdit={vi.fn()} canReport={canReport} />
      </ContextMenu>,
    )
    fireEvent.contextMenu(screen.getByText('Karte'))
  }

  it('«Reko vor Ort» names the Reko, shows the state and writes the Reko tab’s field', async () => {
    openWith({ assignedReko: { id: 'p1', name: 'Keller Marco' }, rekoArrivedAt: null })
    const reko = await screen.findByRole('menuitemcheckbox', { name: /^Reko vor Ort/ })
    expect(reko).toHaveTextContent('Keller Marco')
    expect(reko).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(reko)
    expect(writes.saveRekoArrived).toHaveBeenCalledWith('op-1', undefined)
  })

  it('a ticked «Reko vor Ort» clears it', async () => {
    openWith({ assignedReko: { id: 'p1', name: 'Keller Marco' }, rekoArrivedAt: new Date('2026-11-24T21:41:00Z') })
    const reko = await screen.findByRole('menuitemcheckbox', { name: /^Reko vor Ort/ })
    expect(reko).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(reko)
    expect(writes.saveRekoArrived).toHaveBeenCalledWith('op-1', null)
  })

  it('no Reko, no «Reko vor Ort»; «Abholung nötig» writes the Feld tab’s field with the note', async () => {
    openWith({ assignedReko: null, rekoArrivedAt: null, pickupNeeded: false, pickupNote: 'beim Hintereingang' })
    const pickup = await screen.findByRole('menuitemcheckbox', { name: 'Abholung nötig' })
    expect(screen.queryByRole('menuitemcheckbox', { name: /^Reko vor Ort/ })).toBeNull()
    expect(pickup).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(pickup)
    expect(writes.saveFieldReport).toHaveBeenCalledWith('op-1', { pickup_needed: true, pickup_note: 'beim Hintereingang' })
  })

  it('unticking «Abholung nötig» clears the flag and its note', async () => {
    openWith({ pickupNeeded: true, pickupNote: 'x' })
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Abholung nötig' }))
    expect(writes.saveFieldReport).toHaveBeenCalledWith('op-1', { pickup_needed: false, pickup_note: null })
  })

  it('viewers get neither', async () => {
    openWith({ assignedReko: { id: 'p1', name: 'Keller Marco' } }, false)
    await screen.findByRole('menuitem', { name: 'Bearbeiten' })
    expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0)
  })
})

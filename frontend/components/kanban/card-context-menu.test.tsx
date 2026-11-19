import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { Operation } from '@/lib/contexts/operations-context'

vi.mock('@/lib/hooks/use-print-assignment-slip', () => ({
  usePrintAssignmentSlip: () => ({ print: vi.fn(), printing: false }),
}))

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

import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const addStops = vi.hoisted(() => vi.fn())
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ addStops }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

import { AuftragStopPrompt } from '@/components/auftrag-stop-prompt'
import { askAuftragStop } from '@/lib/auftrag-stop-question'

function ask(assignOnly = vi.fn()) {
  renderWithIntl(<AuftragStopPrompt />)
  act(() =>
    askAuftragStop({ groupId: 'g-nord', groupName: 'Nord', incidentId: 'op-1', incidentLabel: 'Blumenweg 21', vehicleName: 'TLF', assignOnly }),
  )
  return assignOnly
}

// Owner pick #23: TLF drives Auftrag «Nord», the operator puts it on the lone Blumenweg 21.
describe('AuftragStopPrompt', () => {
  it('takes the Einsatz into the Auftrag on Enter', async () => {
    addStops.mockResolvedValue(true)
    ask()
    expect(screen.getByText('Blumenweg 21 als Stopp in Auftrag Nord aufnehmen?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'In Auftrag aufnehmen' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(addStops).toHaveBeenCalledWith('g-nord', ['op-1'])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('«Nur zusätzlich zuweisen» assigns without touching the Auftrag', async () => {
    addStops.mockClear()
    const assignOnly = ask()
    await userEvent.click(screen.getByRole('button', { name: 'Nur zusätzlich zuweisen' }))
    expect(assignOnly).toHaveBeenCalledOnce()
    expect(addStops).not.toHaveBeenCalled()
  })
})

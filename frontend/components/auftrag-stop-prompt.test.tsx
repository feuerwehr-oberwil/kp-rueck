import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const addStopForVehicle = vi.hoisted(() => vi.fn())
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ addStopForVehicle }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AuftragStopPrompt } from '@/components/auftrag-stop-prompt'
import { askAuftragStop } from '@/lib/auftrag-stop-question'
import { toast } from 'sonner'

function ask(assignOnly = vi.fn(), alsoOn: { id: string; label: string }[] = []) {
  renderWithIntl(<AuftragStopPrompt />)
  act(() =>
    askAuftragStop({ groupId: 'g-nord', groupName: 'Nord', incidentId: 'op-1', incidentLabel: 'Blumenweg 21', vehicleId: 'v-tlf', vehicleName: 'TLF', alsoOn, assignOnly }),
  )
  return assignOnly
}

// Owner pick #23: TLF drives Auftrag «Nord», the operator puts it on the lone Blumenweg 21.
// Owner pick #3 (23.11.2026): neither answer is the default, Enter changes nothing.
describe('AuftragStopPrompt', () => {
  it('keeps Enter on Abbrechen and takes the Einsatz into the Auftrag on its card', async () => {
    addStopForVehicle.mockResolvedValue('added')
    ask()
    expect(screen.getByText('TLF fährt schon den Auftrag «Nord»')).toBeInTheDocument()
    const addCard = screen.getByRole('button', { name: 'In Auftrag aufnehmen' })
    expect(addCard).toHaveAccessibleDescription('Blumenweg 21 wird letzter Stopp im Auftrag «Nord», TLF fährt ihn dort an.')
    // No undo after it (pass 2, S9).
    expect(screen.getByRole('button', { name: /Abbrechen/ })).toHaveFocus()
    await userEvent.click(addCard)
    expect(addStopForVehicle).toHaveBeenCalledWith('g-nord', 'op-1', 'v-tlf')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('Enter closes without a write; Z assigns without touching the Auftrag', async () => {
    addStopForVehicle.mockClear()
    const assignOnly = ask()
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(assignOnly).not.toHaveBeenCalled()

    ask(assignOnly)
    await userEvent.keyboard('z')
    expect(assignOnly).toHaveBeenCalledOnce()
    expect(addStopForVehicle).not.toHaveBeenCalled()
  })

  it('names the other Einsatz that has the vehicle too, so «Nur zusätzlich» is the only question', () => {
    ask(vi.fn(), [{ id: 'op-9', label: '13 · Schulstrasse 9' }])
    expect(screen.getByRole('button', { name: 'Nur zusätzlich zuweisen' })).toHaveAccessibleDescription(
      'TLF bleibt auf dem Auftrag «Nord» sowie auf 13 · Schulstrasse 9 und wird zusätzlich Blumenweg 21 zugewiesen. Alle 3 Karten zeigen 3×.',
    )
    expect(screen.getAllByText('TLF · 3×')).toHaveLength(3)
  })

  it('says so and closes when another board changed the Einsatz or the Auftrag meanwhile (S8)', async () => {
    addStopForVehicle.mockResolvedValue('changed')
    ask()
    await userEvent.click(screen.getByRole('button', { name: 'In Auftrag aufnehmen' }))
    expect(toast.error).toHaveBeenCalledWith('Blumenweg 21 nicht aufgenommen', expect.anything())
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

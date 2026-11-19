import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { PickerDialog } from '@/components/ui/picker-dialog'
import { Button } from '@/components/ui/button'

/** «Fahrzeuge zuweisen» open, and a Fahrer picker mounted OUTSIDE its tree – the driver
 *  prompt lives in the root layout. */
function Board({ onSurfaceChange }: { onSurfaceChange: (open: boolean) => void }) {
  const [surfaceOpen, setSurfaceOpen] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <>
      <Dialog open={surfaceOpen} onOpenChange={(open) => { setSurfaceOpen(open); onSurfaceChange(open) }}>
        <DialogContent size="lg" surface="Fahrzeuge zuweisen" aria-describedby={undefined}>
          <DialogTitle>Fahrzeuge zuweisen</DialogTitle>
          <Button onClick={() => setPickerOpen(true)}>Fahrer wählen</Button>
        </DialogContent>
      </Dialog>
      <PickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Fahrer für Trawa"
        description="Kein Fahrer zugewiesen"
        toolbar={<input aria-label="Person suchen" autoFocus />}
        footer={<Button onClick={() => setPickerOpen(false)}>Abbrechen</Button>}
      >
        <p>Muster Hans</p>
      </PickerDialog>
    </>
  )
}

describe('a picker opened from a work surface (owner pick 5A)', () => {
  it('opens inside the surface as a step, not as a second dialog', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Board onSurfaceChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Fahrer wählen' }))

    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs).toHaveLength(1)
    const surface = within(dialogs[0])
    expect(surface.getByRole('heading', { name: 'Fahrer für Trawa' })).toBeInTheDocument()
    expect(surface.getByText('Muster Hans')).toBeInTheDocument()
    // The breadcrumb names where «Zurück» leads.
    expect(surface.getAllByText('Fahrzeuge zuweisen').length).toBeGreaterThan(1)
  })

  it('Esc and «Zurück» end the step and leave the surface open', async () => {
    const user = userEvent.setup()
    const onSurfaceChange = vi.fn()
    renderWithIntl(<Board onSurfaceChange={onSurfaceChange} />)

    await user.click(screen.getByRole('button', { name: 'Fahrer wählen' }))
    expect(screen.getByRole('textbox', { name: 'Person suchen' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Muster Hans')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Back where the operator was: the control that opened the step.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fahrer wählen' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Fahrer wählen' }))
    await user.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(screen.queryByText('Muster Hans')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onSurfaceChange).not.toHaveBeenCalled()

    // Without a step, Esc closes the surface as before.
    await user.keyboard('{Escape}')
    expect(onSurfaceChange).toHaveBeenCalledWith(false)
  })

  it('without an open surface it is its own S window', () => {
    renderWithIntl(
      <PickerDialog open onOpenChange={vi.fn()} title="Reko zuweisen" description="Schulstrasse 9" footer={null}>
        <p>Muster Hans</p>
      </PickerDialog>,
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'sm')
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
  })
})

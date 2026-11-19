import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { PickerDialog } from '@/components/ui/picker-dialog'
import { Button } from '@/components/ui/button'
import { SurfaceStep, useOpeningSurface } from '@/components/ui/surface-step'

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

/** The assignment dialog's shape: its own L window from the board, a step (and a surface
 *  itself) when an L window was open when it opened. */
function Assign({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const host = useOpeningSurface(open, { wideOnly: true })
  if (host) {
    return open ? (
      <SurfaceStep host={host} title="Mannschaft zuweisen" onBack={() => onOpenChange(false)} surface="Mannschaft zuweisen">
        {children}
      </SurfaceStep>
    ) : null
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" surface="Mannschaft zuweisen" aria-describedby={undefined}>
        <DialogTitle>Mannschaft zuweisen</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function Detail({ withDetail }: { withDetail: boolean }) {
  const [assignOpen, setAssignOpen] = useState(!withDetail)
  const [pickerOpen, setPickerOpen] = useState(false)
  return (
    <>
      {withDetail && (
        <Dialog open onOpenChange={vi.fn()}>
          <DialogContent size="lg" surface="Bottmingerstrasse 75" aria-describedby={undefined}>
            <DialogTitle>Bottmingerstrasse 75</DialogTitle>
            <Button onClick={() => setAssignOpen(true)}>Mannschaft</Button>
          </DialogContent>
        </Dialog>
      )}
      <Assign open={assignOpen} onOpenChange={setAssignOpen}>
        <Button onClick={() => setPickerOpen(true)}>Fahrer wählen</Button>
      </Assign>
      <PickerDialog open={pickerOpen} onOpenChange={setPickerOpen} title="Fahrer für Trawa" description="Kein Fahrer" footer={null}>
        <p>Muster Hans</p>
      </PickerDialog>
    </>
  )
}

describe('an assignment opened from the Einsatz-Detail («Schritt im Detail»)', () => {
  it('is a step of the detail, and its own picker the next step – Esc walks back one crumb', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Detail withDetail />)

    await user.click(screen.getByRole('button', { name: 'Mannschaft' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Mannschaft zuweisen' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fahrer wählen' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    const step = screen.getByRole('region', { name: 'Fahrer für Trawa' })
    // The place first, then the assignment, then the picker.
    expect(within(step).getAllByText(/Bottmingerstrasse 75|Mannschaft zuweisen|Fahrer für Trawa/).map((el) => el.textContent).slice(0, 3))
      .toEqual(['Bottmingerstrasse 75', 'Mannschaft zuweisen', 'Fahrer für Trawa'])

    await user.keyboard('{Escape}')
    expect(screen.queryByText('Muster Hans')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mannschaft zuweisen' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'Mannschaft zuweisen' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('opened from the board it is its own L window', () => {
    renderWithIntl(<Detail withDetail={false} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'lg')
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
  })
})

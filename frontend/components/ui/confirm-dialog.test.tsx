import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

describe('ConfirmDialog', () => {
  // The gates' Abbrechen is an undo. A confirm that also reported «closed» would undo the
  // move it had just let stand – the reason the caller-closes mode exists.
  it('with onCancel, a confirm and the third answer never count as a cancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const onSelect = vi.fn()
    renderWithIntl(
      <ConfirmDialog
        open
        onCancel={onCancel}
        title="Kein Fahrzeug"
        description="Der Trupp ist zu Fuss unterwegs."
        confirmText="Fahrzeug zuweisen"
        onConfirm={onConfirm}
        extraAction={{ label: 'Trotzdem beenden', onSelect }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Fahrzeug zuweisen' }))
    await user.click(screen.getByRole('button', { name: 'Trotzdem beenden' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('puts the third answer on its own line above the Abbrechen row', () => {
    renderWithIntl(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Stopp abschliessen?"
        description="Der Trupp fährt weiter."
        confirmText="Stopp abschliessen"
        onConfirm={vi.fn()}
        extraAction={{ label: 'Abschliessen und nächster Stopp', onSelect: vi.fn() }}
      />,
    )

    const extra = screen.getByRole('button', { name: 'Abschliessen und nächster Stopp' })
    const cancel = screen.getByRole('button', { name: 'Abbrechen' })
    const footer = cancel.closest('[data-slot="alert-dialog-footer"]')
    expect(footer).not.toBeNull()
    expect(footer).not.toContainElement(extra)
    expect(extra.compareDocumentPosition(footer as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('ConfirmDialog initial focus', () => {
  const base = { open: true, onOpenChange: vi.fn(), title: 'Frage', description: 'Text', onConfirm: vi.fn(), confirmText: 'Ausführen' }

  it('focuses the main answer, so Enter gives it', () => {
    renderWithIntl(<ConfirmDialog {...base} />)
    expect(screen.getByRole('button', { name: 'Ausführen' })).toHaveFocus()
  })

  it('focuses Abbrechen on a destructive ask, or when the caller asks for it', () => {
    const { unmount } = renderWithIntl(<ConfirmDialog {...base} variant="destructive" />)
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus()
    unmount()
    renderWithIntl(<ConfirmDialog {...base} initialFocus="cancel" />)
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus()
  })
})

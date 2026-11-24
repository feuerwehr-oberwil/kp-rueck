import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { FeldAddPicker } from '@/components/feld/feld-add-picker'

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => mobile.value }))

function open(onAdd = vi.fn()) {
  renderWithIntl(
    <FeldAddPicker
      label="Fahrzeug hinzufügen"
      chipLabel="Fahrzeug"
      searchPlaceholder="Fahrzeug suchen"
      items={[{ key: 'v1', name: 'ADL Oberwil' }]}
      onAdd={onAdd}
    />,
  )
  return userEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }))
}

describe('FeldAddPicker surface', () => {
  it('is a bottom sheet on a phone', async () => {
    mobile.value = true
    await open()
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-slot', 'sheet-content')
  })

  it('is a centred dialog on the desktop board, with the same picking', async () => {
    mobile.value = false
    const onAdd = vi.fn()
    await open(onAdd)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')

    await userEvent.click(within(dialog).getByRole('button', { name: 'ADL Oberwil' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Fertig (1)' }))
    expect(onAdd).toHaveBeenCalledWith([{ key: 'v1', name: 'ADL Oberwil' }], [])
  })

  it('keeps the ticks when the dialog is closed with Escape', async () => {
    mobile.value = false
    const onAdd = vi.fn()
    await open(onAdd)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'ADL Oberwil' }))
    await userEvent.keyboard('{Escape}')
    expect(onAdd).toHaveBeenCalledWith([{ key: 'v1', name: 'ADL Oberwil' }], [])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

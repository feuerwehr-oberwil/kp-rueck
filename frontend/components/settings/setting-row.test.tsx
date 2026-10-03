import { afterEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { SettingRow } from '@/components/settings/setting-row'
import { DetailField } from '@/components/kanban/detail-field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/**
 * Owner rule (02.10.2026): on the phone a label sits ABOVE its field. `SettingRow` and
 * `DetailField` decide that themselves (`useStackedFields`, < 768px); the callers pass nothing.
 * jsdom has no matchMedia, so the hook reads `innerWidth` — set per test.
 */
const setWidth = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })
}
afterEach(() => setWidth(1024))

const row = () => document.querySelector<HTMLElement>('[data-slot="setting-row"]')!
const control = () => row().querySelector<HTMLElement>('[data-slot="setting-control"]')!

function GeneralRow() {
  return (
    <SettingRow label="Einsatzgebiet (Ort)" htmlFor="area" hint="Haupteinsatzgebiet für vereinfachte Adressanzeige">
      <Input id="area" defaultValue="Oberwil, BL" />
    </SettingRow>
  )
}

describe('SettingRow on the phone', () => {
  it('stacks label → hint → full-width control at 390px', () => {
    setWidth(390)
    renderWithIntl(<GeneralRow />)
    expect(row()).toHaveAttribute('data-stacked')
    const line = control().parentElement!
    expect(line).toHaveClass('flex-col')
    // DOM order is reading order: label, hint, then the control
    const label = screen.getByText('Einsatzgebiet (Ort)')
    const hint = screen.getByText(/Haupteinsatzgebiet/)
    const input = screen.getByLabelText('Einsatzgebiet (Ort)')
    expect(label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hint.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // the control column spans the row instead of being a 200px column at the right
    expect(control()).toHaveClass('w-full')
    expect(control()).not.toHaveClass('min-w-[200px]')
  })

  it('keeps a switch beside its label (the phone settings norm)', () => {
    setWidth(390)
    renderWithIntl(
      <SettingRow label="Ton bei neuen Einsätzen" htmlFor="sound">
        <Switch id="sound" />
      </SettingRow>,
    )
    // the row turns back into a line when its control holds a switch (CSS :has)
    expect(control().parentElement!.className).toMatch(/has-\[>\[data-slot=setting-control\]_\[data-slot=switch\]\]:flex-row/)
    expect(control().className).toMatch(/has-\[\[data-slot=switch\]\]:w-auto/)
  })

  it('keeps the side-by-side row on desktop', () => {
    setWidth(1440)
    renderWithIntl(<GeneralRow />)
    expect(row()).not.toHaveAttribute('data-stacked')
    expect(control().parentElement).toHaveClass('flex', 'items-center')
    expect(control().parentElement).not.toHaveClass('flex-col')
    expect(control()).toHaveClass('min-w-[200px]')
  })
})

describe('DetailField on the phone', () => {
  it('puts the label above the control without the caller asking', () => {
    setWidth(390)
    renderWithIntl(
      <DetailField label="Name" htmlFor="name">
        <Input id="name" />
      </DetailField>,
    )
    const label = screen.getByText('Name', { selector: 'label' })
    expect(label).toHaveClass('block')
    expect(label).not.toHaveClass('w-[120px]')
    expect(label.nextElementSibling).toContainElement(screen.getByLabelText('Name'))
  })

  it('keeps the 120px label column on desktop, and an explicit `stacked` wins', () => {
    setWidth(1440)
    const { unmount } = renderWithIntl(
      <DetailField label="Name" htmlFor="name">
        <Input id="name" />
      </DetailField>,
    )
    expect(screen.getByText('Name', { selector: 'label' })).toHaveClass('w-[120px]')
    unmount()
    renderWithIntl(
      <DetailField label="Name" htmlFor="name" stacked>
        <Input id="name" />
      </DetailField>,
    )
    expect(screen.getByText('Name', { selector: 'label' })).toHaveClass('block')
  })
})

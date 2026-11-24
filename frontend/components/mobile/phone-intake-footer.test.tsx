/**
 * The Übung menu of the phone board's footer (owner pick 5B, phone sweep 24.11.2026): Normal,
 * Kritisch and Telefon trigger at once – no page in between – and the Übungs-Steuerung is one
 * row further.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const alarm = vi.hoisted(() => ({ generate: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const refreshOperations = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/training-alarm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/training-alarm')>()),
  generateTrainingAlarm: alarm.generate,
}))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: { id: 'e1' } }) }))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ refreshOperations }) }))
vi.mock('next/link', () => ({
  default: ({ href, onNavigate, children, ...rest }: React.ComponentProps<'a'> & { href: string; onNavigate?: () => void }) => (
    <a href={href} {...rest} onClick={(e) => { e.preventDefault(); onNavigate?.() }}>{children}</a>
  ),
}))

import { PhoneIntakeFooter } from './phone-intake-footer'

describe('PhoneIntakeFooter', () => {
  beforeEach(() => {
    alarm.generate.mockReset().mockResolvedValue({ title: 'Wohnungsbrand', location_display: 'Hauptstrasse 4', location_address: null })
    toast.success.mockClear()
  })

  it('is the one «Neuer Einsatz» button outside an Übung', () => {
    renderWithIntl(<PhoneIntakeFooter onNewIncident={() => {}} training={false} />)
    expect(screen.getByRole('button', { name: 'Neuer Einsatz' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Übungs-Einsatz auslösen' })).toBeNull()
  })

  it('triggers a Kritisch at once from the ▴ menu and says so', async () => {
    const user = userEvent.setup()
    renderWithIntl(<PhoneIntakeFooter onNewIncident={() => {}} training />)
    await user.click(screen.getByRole('button', { name: 'Übungs-Einsatz auslösen' }))
    await user.click(screen.getByRole('menuitem', { name: 'Kritisch' }))

    expect(alarm.generate).toHaveBeenCalledWith('e1', 'critical')
    expect(toast.success).toHaveBeenCalledWith('Kritischer Einsatz generiert', { description: 'Wohnungsbrand @ Hauptstrasse 4' })
    expect(refreshOperations).toHaveBeenCalled()
  })

  it('offers the Übungs-Steuerung as the menu’s last row', async () => {
    const user = userEvent.setup()
    renderWithIntl(<PhoneIntakeFooter onNewIncident={() => {}} training />)
    await user.click(screen.getByRole('button', { name: 'Übungs-Einsatz auslösen' }))
    expect(screen.getByRole('menuitem', { name: /Übungs-Steuerung öffnen/ })).toHaveAttribute('href', '/training')
  })
})

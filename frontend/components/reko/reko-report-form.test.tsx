import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))

import { EMPTY_REKO_FORM, RekoReportForm, toRekoFormData } from '@/components/reko/reko-report-form'

/**
 * §8.5's frontend half: **the same field set under both mounts.**
 *
 * The rule this pins down is plan 25 §6.1's and plan 26 §5.1's: one component,
 * two mounts. A second form for the KP is how the board silently loses a field
 * six months later — so the assertion is not "the KP form works", it is "the KP
 * form asks exactly the same questions the crew is asked".
 */

const FIELDS = ['Einsatz relevant? *', 'Gefahren', 'Aufwand', 'Stromversorgung', 'Zusammenfassung']

function fieldSetOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('label, textarea, input, button')).map(el =>
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? `${el.tagName}:${el.id || el.getAttribute('placeholder') || ''}`
      : `${el.tagName}:${el.textContent?.trim() ?? ''}`,
  )
}

describe('the Reko field set (plan 26 §5.1)', () => {
  it('renders the identical field set under both mounts', () => {
    const feld = renderWithIntl(
      <RekoReportForm incidentId="i-1" value={EMPTY_REKO_FORM} onChange={vi.fn()} mount="feld" onSubmit={vi.fn()} />,
    )
    const feldFields = fieldSetOf(feld.container)
    feld.unmount()

    const kp = renderWithIntl(
      <RekoReportForm incidentId="i-1" value={EMPTY_REKO_FORM} onChange={vi.fn()} mount="kp" onSubmit={vi.fn()} />,
    )
    const kpFields = fieldSetOf(kp.container)

    // The submit button's label is the one deliberate difference — copy only,
    // never behaviour. Everything before it must match exactly.
    expect(kpFields.slice(0, -1)).toEqual(feldFields.slice(0, -1))
    for (const label of FIELDS) {
      expect(kpFields.join('|')).toContain(label)
    }
  })

  it('asks every question on the board that it asks on the phone', () => {
    renderWithIntl(
      <RekoReportForm incidentId="i-1" value={EMPTY_REKO_FORM} onChange={vi.fn()} mount="kp" onSubmit={vi.fn()} />,
    )

    for (const label of FIELDS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // Every danger the crew can tick, the KP can tick.
    for (const danger of ['Brandgefahr', 'Explosionsgefahr', 'Einsturzgefahr']) {
      expect(screen.getByText(new RegExp(danger))).toBeInTheDocument()
    }
  })

  it('refuses to submit until "Einsatz relevant?" is answered — on both mounts', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderWithIntl(
      <RekoReportForm incidentId="i-1" value={EMPTY_REKO_FORM} onChange={vi.fn()} mount="kp" onSubmit={onSubmit} />,
    )

    await user.click(screen.getByRole('button', { name: /Bericht speichern/ }))
    expect(onSubmit).not.toHaveBeenCalled()

    // Answered — the same field set, now submittable.
    renderWithIntl(
      <RekoReportForm
        incidentId="i-1"
        value={{ ...EMPTY_REKO_FORM, is_relevant: true }}
        onChange={vi.fn()}
        mount="kp"
        onSubmit={onSubmit}
      />,
    )
    await user.click(screen.getAllByRole('button', { name: /Bericht speichern/ })[1])
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('omits the photo block where the mount has no door for it', () => {
    // The board has no session-authed Reko photo endpoint yet, and an upload
    // control that answers 400 is worse than one that is not offered.
    const kp = renderWithIntl(
      <RekoReportForm incidentId="i-1" value={EMPTY_REKO_FORM} onChange={vi.fn()} mount="kp" onSubmit={vi.fn()} />,
    )
    expect(kp.container.textContent).not.toContain('Fotos')
  })

  it('reads an existing report into the form, so an amendment starts from what is there', () => {
    const form = toRekoFormData({
      is_relevant: false,
      power_supply: 'emergency_needed',
      summary_text: 'Keller trocken',
      additional_notes: null,
      dangers_json: null,
      effort_json: null,
      photos_json: ['a.jpg'],
    })

    expect(form.is_relevant).toBe(false)
    expect(form.power_supply).toBe('emergency_needed')
    expect(form.summary_text).toBe('Keller trocken')
    // Missing blocks fall back to the empty shape rather than to undefined —
    // an amendment must never crash on a report the crew left half-filled.
    expect(form.dangers_json).toEqual(EMPTY_REKO_FORM.dangers_json)
    expect(form.effort_json).toEqual(EMPTY_REKO_FORM.effort_json)
    expect(form.additional_notes).toBe('')
  })
})

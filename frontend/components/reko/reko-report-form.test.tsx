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

// The asterisk is the separate required marker beside the label, not part of
// the label — it used to be in both and the form read «Einsatz relevant? * *».
//
// «Aufwand» is NOT in this list: it is a section heading over two questions,
// and the board's field list has no headings — «Anzahl Personen» and «Dauer in
// Stunden» are rows of their own there. The questions are what has to match
// across the mounts, not the furniture around them, so the two questions are
// listed instead.
const FIELDS = [
  'Einsatz relevant?',
  'Gefahren',
  'Anzahl Personen',
  'Dauer in Stunden',
  'Stromversorgung',
  'Zusammenfassung',
]

/**
 * The WRITABLE fields, by the id the form gives them — not the DOM around them.
 *
 * The two mounts render the same questions with different controls: a phone in
 * the rain gets four thumb-sized Stromversorgung buttons, a desktop gets one
 * narrow select, and a label that only repeats what the placeholder already says
 * is dropped where space is short. None of that may change WHAT is asked, which
 * is what this compares.
 */
function writableFieldsOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('textarea, input'))
    .map(el => `${el.tagName}:${(el as HTMLInputElement).id || el.getAttribute('placeholder') || ''}`)
    // Nameless inputs are not fields: they are the hidden proxies Radix's
    // Checkbox puts in the form so a native submit carries its value. The
    // phone has five of them behind its danger tiles, the board none behind
    // its toggle marks — which says nothing about what either mount asks.
    .filter(name => !name.endsWith(':'))
    .sort()
}

describe('the Reko field set (plan 26 §5.1)', () => {
  it('renders the identical field set under both mounts', () => {
    const feld = renderWithIntl(
      <RekoReportForm incidentId="i-1" value={EMPTY_REKO_FORM} onChange={vi.fn()} mount="feld" onSubmit={vi.fn()} />,
    )
    const feldFields = writableFieldsOf(feld.container)
    const feldText = feld.container.textContent ?? ''
    feld.unmount()

    const kp = renderWithIntl(
      <RekoReportForm incidentId="i-1" value={EMPTY_REKO_FORM} onChange={vi.fn()} mount="kp" onSubmit={vi.fn()} />,
    )
    const kpFields = writableFieldsOf(kp.container)

    // Every field a crew can write, the KP can write.
    expect(kpFields).toEqual(feldFields)
    // …and every question is asked on both, whatever control carries it.
    for (const label of FIELDS) {
      expect(feldText).toContain(label)
      expect(kp.container.textContent ?? '').toContain(label)
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

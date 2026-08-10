import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

vi.mock('@/components/feld/feld-rapport-form', () => ({
  FeldRapportForm: () => <div>Rapport-Formular</div>,
}))
vi.mock('@/components/kanban/material-return-list', () => ({
  MaterialReturnList: () => <div>Material zurück</div>,
}))
vi.mock('@/lib/api-client', () => ({ apiClient: {} }))

import { SchadenplatzRapportSection } from '@/components/kanban/schadenplatz-rapport-section'

describe('SchadenplatzRapportSection', () => {
  it('offers the form once the Schadenplatz has been disponiert', () => {
    renderWithIntl(<SchadenplatzRapportSection incidentId="inc-1" applies />)

    expect(screen.getByText('Rapport-Formular')).toBeInTheDocument()
    expect(screen.getByText('kein Rapport')).toBeInTheDocument()
  })

  it('states why there is no form instead of offering an empty one', () => {
    renderWithIntl(<SchadenplatzRapportSection incidentId="inc-1" applies={false} />)

    // The section header stays — the operator came to this tab looking for it,
    // and a silently missing block reads as a bug.
    expect(screen.getByText('Schadenplatz-Rapport')).toBeInTheDocument()
    expect(screen.getByText('noch nicht disponiert')).toBeInTheDocument()
    expect(
      screen.getByText('Ein Rapport wird erst erfasst, wenn der Schadenplatz disponiert wurde.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Rapport-Formular')).not.toBeInTheDocument()
    // …and no "kein Rapport" state either: that reads as an outstanding task.
    expect(screen.queryByText('kein Rapport')).not.toBeInTheDocument()
  })
})

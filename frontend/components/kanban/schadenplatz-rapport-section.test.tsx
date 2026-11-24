import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

// Counts mounts and keeps the last `onSaved`, so a test can tell a reload from a re-render.
const form = vi.hoisted(() => ({ mounts: 0, onSaved: (_saved: { is_draft: boolean }) => {} }))
vi.mock('@/components/feld/feld-rapport-form', () => ({
  FeldRapportForm: ({ onSaved }: { onSaved: (saved: { is_draft: boolean }) => void }) => {
    useState(() => (form.mounts += 1))
    form.onSaved = onSaved
    return <div>Rapport-Formular</div>
  },
}))
const useMaterialRelease = vi.hoisted(() => vi.fn(() => ({ units: [], loading: false, releasing: false, release: vi.fn() })))
vi.mock('@/lib/hooks/use-material-release', () => ({ useMaterialRelease }))
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

  it('follows the board when a rapport is filed on /feld while the detail is open (Sol review)', () => {
    const { rerender } = renderWithIntl(<SchadenplatzRapportSection incidentId="inc-1" applies hasRapport={false} />)
    expect(useMaterialRelease).toHaveBeenLastCalledWith('inc-1', expect.objectContaining({ enabled: false }))

    rerender(<SchadenplatzRapportSection incidentId="inc-1" applies hasRapport />)

    expect(screen.getByText('erfasst')).toBeInTheDocument()
    expect(useMaterialRelease).toHaveBeenLastCalledWith('inc-1', expect.objectContaining({ enabled: true }))
  })

  it('reloads the form for a filing from /feld, never for its own save (Sol round 2)', () => {
    const { rerender } = renderWithIntl(<SchadenplatzRapportSection incidentId="inc-1" applies hasRapport={false} />)
    const before = form.mounts

    // The crew filed on /feld: the board flag flips while this form holds the old rows.
    rerender(<SchadenplatzRapportSection incidentId="inc-1" applies hasRapport />)
    expect(form.mounts).toBe(before + 1)
  })

  it('keeps the form mounted when its own first save files the rapport', () => {
    const { rerender } = renderWithIntl(<SchadenplatzRapportSection incidentId="inc-1" applies hasRapport={false} />)
    const before = form.mounts

    act(() => form.onSaved({ is_draft: false }))
    rerender(<SchadenplatzRapportSection incidentId="inc-1" applies hasRapport />)
    expect(form.mounts).toBe(before)
  })
})


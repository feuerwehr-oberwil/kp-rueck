import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiDuplicateCandidate } from '@/lib/api-client'
import { DuplicateHint } from './duplicate-hint'

/**
 * The amber «Möglicherweise dasselbe wie …» (R2). Advice: a status, never an
 * alert, and the two answers are plain buttons — a Tab and an Enter away.
 */

const candidate = (overrides: Partial<ApiDuplicateCandidate> = {}): ApiDuplicateCandidate => ({
  id: 'c1',
  title: 'Hauptstrasse 6, 4104 Oberwil',
  type: 'elementarereignis',
  status: 'incoming',
  location_address: 'Hauptstrasse 6, 4104 Oberwil',
  location_display: 'Hauptstrasse 6',
  location_lat: '47.51536',
  location_lng: '7.556',
  distance_m: 40,
  match: 'distance',
  created_at: new Date(Date.now() - 6 * 60_000).toISOString(),
  ...overrides,
})

describe('DuplicateHint', () => {
  it('names the card, the distance and its age, and says nothing without candidates', () => {
    const { container, rerender } = renderWithIntl(
      <DuplicateHint candidates={[]} onMerge={vi.fn()} onDismiss={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<DuplicateHint candidates={[candidate()]} onMerge={vi.fn()} onDismiss={vi.fn()} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Möglicherweise dasselbe wie Hauptstrasse 6 · 40 m · vor 6')
  })

  it('says «gleiche Adresse» for an address-only match', () => {
    renderWithIntl(
      <DuplicateHint
        candidates={[candidate({ match: 'address', distance_m: null, location_lat: null, location_lng: null })]}
        onMerge={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('gleiche Adresse')
  })

  it('merges into the named card and dismisses, by keyboard alone', async () => {
    const user = userEvent.setup()
    const onMerge = vi.fn()
    const onDismiss = vi.fn()
    renderWithIntl(<DuplicateHint candidates={[candidate()]} onMerge={onMerge} onDismiss={onDismiss} />)
    await user.tab()
    expect(screen.getByRole('button', { name: /Zusammenführen/ })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onMerge).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Trotzdem neu' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onDismiss).toHaveBeenCalled()
  })

  it('draws the 50 m sketch only when both sides have a pin', () => {
    const { rerender } = renderWithIntl(
      <DuplicateHint candidates={[candidate()]} origin={{ lat: 47.515, lng: 7.556 }} onMerge={vi.fn()} onDismiss={vi.fn()} />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
    rerender(<DuplicateHint candidates={[candidate()]} origin={null} onMerge={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('offers no merge when read-only', () => {
    renderWithIntl(<DuplicateHint candidates={[candidate()]} readOnly onMerge={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Zusammenführen/ })).toBeNull()
  })
})

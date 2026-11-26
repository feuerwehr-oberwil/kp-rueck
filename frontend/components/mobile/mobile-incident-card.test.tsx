import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'
import type { IncidentGroup } from '@/lib/types/groups'

/**
 * The phone Einsatz card tells the crew in the detail sheet's order, and VoiceOver finds a
 * named control on it (phone sweep 24.11.2026: findings 20 and A2).
 */

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))

import { MobileIncidentCard } from '@/components/mobile/mobile-incident-card'

const operation = {
  id: 'incident-1',
  number: 7,
  location: 'Hauptstrasse 1',
  vehicles: [],
  incidentType: 'brandbekaempfung',
  dispatchTime: new Date('2026-08-09T10:00:00Z'),
  crew: [
    { personnelId: 'p-1', name: 'Hoffmann Lisa' },
    { personnelId: 'p-2', name: 'Müller Hans' },
  ],
  priority: 'low',
  status: 'active',
  materials: [],
  notes: '',
  leaderId: 'p-2',
  leaderName: 'Müller Hans',
} as unknown as Operation

describe('the phone Einsatz card', () => {
  it('lists the Einsatzleiter first in the crew, as the detail sheet does', () => {
    renderWithIntl(<MobileIncidentCard operation={operation} onClick={vi.fn()} formatLocation={(a) => a} />)
    expect(screen.getByText('Mannschaft').nextElementSibling).toHaveTextContent('Müller Hans, Hoffmann Lisa')
  })

  it('offers one named button that opens the detail, once', async () => {
    const onClick = vi.fn()
    renderWithIntl(<MobileIncidentCard operation={operation} onClick={onClick} formatLocation={(a) => a} />)
    await userEvent.click(screen.getByRole('button', { name: 'Details anzeigen: 7 · Hauptstrasse 1' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('names the Auftrag of a route stop with what it owns, as the desk card does', () => {
    const auftrag = {
      group: { id: 'g-1', name: 'Sturmholz Oberwil', color: '#0e6680', stopIds: ['incident-0', 'incident-1'] } as IncidentGroup,
      resources: {
        vehicles: [{ assignmentId: 'ga-1', resourceId: 'v-1', name: 'TLF' }],
        personnel: [{ assignmentId: 'ga-2', resourceId: 'p-3', name: 'Moser Lea' }],
        materials: [],
      },
    }
    const stop = { ...operation, crew: [], groupId: 'g-1', groupPosition: 1 } as Operation
    renderWithIntl(<MobileIncidentCard operation={stop} onClick={vi.fn()} formatLocation={(a) => a} auftrag={auftrag} />)
    const row = screen.getByText('Auftrag').nextElementSibling
    expect(row).toHaveTextContent('Sturmholz Oberwil')
    expect(row).toHaveTextContent('Stopp 2 von 2 · TLF · 1 Pers')
  })
})

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
import { crewMember, makeOperation } from '@/test-utils/operation-fixtures'

const operation = makeOperation({
  id: 'incident-1',
  number: 7,
  location: 'Hauptstrasse 1',
  incidentType: 'brandbekaempfung',
  dispatchTime: new Date('2026-08-09T10:00:00Z'),
  crew: [
    crewMember('Hoffmann Lisa', 'p-1'),
    crewMember('Müller Hans', 'p-2'),
  ],
  priority: 'low',
  status: 'active',
  leaderId: 'p-2',
  leaderName: 'Müller Hans',
})

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
    const auftrag = { id: 'g-1', name: 'Sturmholz Oberwil', color: '#0e6680', stopIds: ['incident-0', 'incident-1'] } as IncidentGroup
    const stop: Operation = {
      ...operation,
      crew: [],
      groupId: 'g-1',
      groupPosition: 1,
      auftragResources: {
        vehicles: [{ assignmentId: 'ga-1', resourceId: 'v-1', name: 'TLF' }],
        personnel: [{ assignmentId: 'ga-2', resourceId: 'p-3', name: 'Moser Lea' }],
        materials: [],
      },
    }
    renderWithIntl(<MobileIncidentCard operation={stop} onClick={vi.fn()} formatLocation={(a) => a} auftrag={auftrag} />)
    const row = screen.getByText('Auftrag').nextElementSibling
    expect(row).toHaveTextContent('Sturmholz Oberwil')
    expect(row).toHaveTextContent('Stopp 2 von 2 · TLF · 1 Pers')
  })
})

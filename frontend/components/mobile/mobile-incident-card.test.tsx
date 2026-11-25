import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

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
})

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import de from '@/messages/de.json'
import type { Operation, Person } from '@/lib/contexts/operations-context'
import { MobilePersonnelSheet } from '@/components/mobile/mobile-personnel-sheet'

/**
 * The phone «Personal» sheet, two lines per person like the Appell (phone sweep 14.11.2026):
 * the full name, then where · the state in a word · Reko · tags. A «Zugewiesen» badge beside
 * the name used to cut «Bendik-Dimitrijević Alexandra».
 */

const person = (over: Partial<Person>) =>
  ({ id: 'p1', name: 'Aebi Lionel', role: 'Mannschaft', status: 'available', tags: [], isReko: false, ...over }) as Person

const operation = {
  id: 'i1',
  location: 'Mühlemattstrasse 18',
  locationDisplay: 'Mühlemattstrasse 18',
  incidentType: 'elementarereignis',
  crew: [{ personnelId: 'p2', name: 'Bendik-Dimitrijević Alexandra' }],
} as unknown as Operation

describe('MobilePersonnelSheet', () => {
  it('gives a long name its own line and says where and what in words on the next', () => {
    renderWithIntl(
      <MobilePersonnelSheet
        open
        onOpenChange={() => {}}
        operations={[operation]}
        personnel={[
          person({ id: 'p2', name: 'Bendik-Dimitrijević Alexandra', status: 'assigned', isReko: true, tags: ['Atemschutz'] }),
          person({ id: 'p3', name: 'Berger Maja', status: 'unavailable' }),
        ]}
      />,
    )
    const name = screen.getByText('Bendik-Dimitrijević Alexandra')
    expect(name).not.toHaveClass('truncate')
    expect(screen.getByText('Mühlemattstrasse 18 · zugewiesen · Reko · Atemschutz')).toBeInTheDocument()
    expect(screen.getByText('nicht verfügbar')).toBeInTheDocument()
  })

  // A route crew is held on its Auftrag, not on an incident: `status` stays «available», and the
  // sheet called them frei while the board's sidebar drew them gebunden.
  it('counts nobody on an Auftrag or a Reko as verfügbar', () => {
    renderWithIntl(
      <MobilePersonnelSheet
        open
        onOpenChange={() => {}}
        operations={[]}
        personnel={[
          person({ id: 'p1', name: 'Aebi Lionel' }),
          person({ id: 'p2', name: 'Frei Marc', isOnAuftrag: true }),
          person({ id: 'p3', name: 'Keller Marco', isReko: true }),
        ]}
      />,
    )
    expect(screen.getByText('1/3 verfügbar')).toBeInTheDocument()
    expect(screen.getAllByText(/zugewiesen/)).toHaveLength(2)
  })

  // Phone sweep 24.11.2026 #23: the row named the Einsatz but led nowhere.
  it('opens the Einsatz of a person on exactly one, and leaves a person on two a plain row', async () => {
    const onOpenIncident = vi.fn()
    const second = { ...operation, id: 'i2', crew: [{ personnelId: 'p3', name: 'Berger Maja' }] } as unknown as Operation
    const third = { ...operation, id: 'i3', crew: [{ personnelId: 'p3', name: 'Berger Maja' }] } as unknown as Operation
    renderWithIntl(
      <MobilePersonnelSheet
        open
        onOpenChange={() => {}}
        onOpenIncident={onOpenIncident}
        operations={[operation, second, third]}
        personnel={[
          person({ id: 'p2', name: 'Bendik-Dimitrijević Alexandra', status: 'assigned' }),
          person({ id: 'p3', name: 'Berger Maja', status: 'assigned' }),
        ]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Bendik-Dimitrijević Alexandra/ }))
    expect(onOpenIncident).toHaveBeenCalledWith('i1')
    expect(screen.queryByRole('button', { name: /Berger Maja/ })).toBeNull()
  })

  // `t(`state.${status}`)` is a dynamic key: neither tsc nor the literal-key check follows it.
  it('has a word for every person state', () => {
    expect(Object.keys(de.incidents.mobilePersonnel.state).sort()).toEqual(['assigned', 'available', 'unavailable'])
  })
})

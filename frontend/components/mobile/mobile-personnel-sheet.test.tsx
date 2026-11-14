import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
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

  // `t(`state.${status}`)` is a dynamic key: neither tsc nor the literal-key check follows it.
  it('has a word for every person state', () => {
    expect(Object.keys(de.incidents.mobilePersonnel.state).sort()).toEqual(['assigned', 'available', 'unavailable'])
  })
})

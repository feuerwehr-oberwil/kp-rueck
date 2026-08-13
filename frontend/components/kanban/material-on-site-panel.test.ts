import { describe, expect, it } from 'vitest'
import type { Material } from '@/lib/contexts/materials-context'
import {
  selectMaterialOnSite,
  type MaterialOnSiteLocation,
} from '@/components/kanban/material-on-site-panel'

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: 'material-1',
    name: 'Tauchpumpe 1',
    category: 'Magazin',
    type: 'Tauchpumpen',
    status: 'assigned',
    categorySortOrder: 0,
    consumable: false,
    groupId: null,
    ...overrides,
  }
}

function at(overrides: Partial<MaterialOnSiteLocation> = {}): MaterialOnSiteLocation {
  return {
    incidentId: 'incident-1',
    address: 'Hauptstrasse 1',
    since: '2026-08-09T18:00:00Z',
    ...overrides,
  }
}

describe('selectMaterialOnSite', () => {
  it('names the units from the depot and keeps the Schadenplatz they stand at', () => {
    const entries = selectMaterialOnSite(
      new Map([['material-1', at()]]),
      [material()],
    )

    expect(entries).toEqual([
      {
        materialId: 'material-1',
        name: 'Tauchpumpe 1',
        incidentId: 'incident-1',
        address: 'Hauptstrasse 1',
        since: new Date('2026-08-09T18:00:00Z'),
      },
    ])
  })

  it('puts the longest-standing unit first', () => {
    const entries = selectMaterialOnSite(
      new Map([
        ['recent', at({ since: '2026-08-09T22:00:00Z' })],
        ['oldest', at({ since: '2026-08-09T06:00:00Z' })],
      ]),
      [material({ id: 'recent', name: 'Nass-Sauger' }), material({ id: 'oldest', name: 'Tauchpumpe 1' })],
    )

    expect(entries.map((entry) => entry.materialId)).toEqual(['oldest', 'recent'])
  })

  it('sorts an unknown «seit» last — no timestamp is not evidence of an old one', () => {
    const entries = selectMaterialOnSite(
      new Map([
        ['unknown', at({ since: null })],
        ['dated', at({ since: '2026-08-09T22:00:00Z' })],
      ]),
      [material({ id: 'unknown', name: 'Aggregat' }), material({ id: 'dated', name: 'Tauchpumpe 1' })],
    )

    expect(entries.map((entry) => entry.materialId)).toEqual(['dated', 'unknown'])
    expect(entries[1].since).toBeNull()
  })

  it('drops a unit the depot no longer knows — a row that cannot say which pump is useless', () => {
    const entries = selectMaterialOnSite(new Map([['deleted', at()]]), [material()])
    expect(entries).toEqual([])
  })

  it('is empty when nothing was left standing', () => {
    expect(selectMaterialOnSite(new Map(), [material()])).toEqual([])
  })
})

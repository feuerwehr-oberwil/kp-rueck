import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATERIAL_VIEW,
  isDefaultMaterialView,
  isMaterialViewPrefs,
  materialFacets,
  materialFilterCount,
  viewMaterials,
  type MaterialViewPrefs,
  type ViewableMaterial,
} from './material-view'

// API order: depot sort order (TLF before Pio), then name.
const DEPOT: ViewableMaterial[] = [
  { name: 'Motorsäge', category: 'TLF', type: 'Sägen', status: 'assigned' },
  { name: 'Tauchpumpe', category: 'TLF', type: 'Pumpen', status: 'available' },
  { name: 'Ölbindemittel', category: 'TLF', type: '', status: 'assigned', consumable: true },
  { name: 'Tauchpumpe', category: 'Pio', type: 'Pumpen', status: 'available' },
  { name: 'Wassersauger', category: 'Pio', type: 'Pumpen', status: 'available', outOfService: true },
]

const prefs = (over: Partial<MaterialViewPrefs>): MaterialViewPrefs => ({ ...DEFAULT_MATERIAL_VIEW, ...over })
const names = (items: readonly { name: string }[]) => items.map((m) => m.name)

describe('viewMaterials', () => {
  it('keeps today’s depot list by default, in the API’s order', () => {
    const { groups } = viewMaterials(DEPOT, DEFAULT_MATERIAL_VIEW)
    expect(groups.map((g) => g.key)).toEqual(['TLF', 'Pio'])
    expect(groups[0].places).toEqual([{ location: 'TLF', items: DEPOT.slice(0, 3) }])
  })

  it('by Typ: types alphabetical, «no Typ» last, the depots inside each', () => {
    const { groups } = viewMaterials(DEPOT, prefs({ sort: 'type' }))
    expect(groups.map((g) => g.key)).toEqual(['Pumpen', 'Sägen', ''])
    // Two identical Tauchpumpen in two depots stay apart: which one goes out matters.
    expect(groups[0].places.map((p) => [p.location, names(p.items)])).toEqual([
      ['TLF', ['Tauchpumpe']],
      ['Pio', ['Tauchpumpe', 'Wassersauger']],
    ])
  })

  it('Frei is what «Nur Verfügbare» kept: consumables stay, out-of-service goes', () => {
    expect(names(viewMaterials(DEPOT, prefs({ status: 'free' })).shown)).toEqual([
      'Tauchpumpe',
      'Ölbindemittel',
      'Tauchpumpe',
    ])
    expect(names(viewMaterials(DEPOT, prefs({ status: 'bound' })).shown)).toEqual(['Motorsäge'])
    expect(names(viewMaterials(DEPOT, prefs({ status: 'not-ready' })).shown)).toEqual(['Wassersauger'])
  })

  it('Standort and Typ are each one of, and combine with each other', () => {
    expect(viewMaterials(DEPOT, prefs({ locations: ['Pio'] })).shown).toHaveLength(2)
    expect(viewMaterials(DEPOT, prefs({ types: ['Sägen', ''] })).shown).toHaveLength(2)
    expect(names(viewMaterials(DEPOT, prefs({ locations: ['TLF'], types: ['Pumpen'] })).shown)).toEqual(['Tauchpumpe'])
  })
})

describe('materialFacets', () => {
  it('counts units over the searched list, depots in station order, types alphabetical', () => {
    const facets = materialFacets(DEPOT, prefs({ status: 'free' }))
    expect(facets.status).toEqual({ all: 5, free: 3, bound: 1, 'not-ready': 1 })
    expect(facets.locations).toEqual([
      { key: 'TLF', count: 3 },
      { key: 'Pio', count: 2 },
    ])
    expect(facets.types.map((f) => f.key)).toEqual(['Pumpen', 'Sägen', ''])
  })

  it('keeps a remembered value nothing carries any more, at 0, so it can be unticked', () => {
    const facets = materialFacets(DEPOT, prefs({ locations: ['Magazin'], types: ['Leitern'] }))
    expect(facets.locations.at(-1)).toEqual({ key: 'Magazin', count: 0 })
    expect(facets.types).toContainEqual({ key: 'Leitern', count: 0 })
  })
})

describe('the prefs', () => {
  it('count filters, not the sort', () => {
    expect(materialFilterCount(prefs({ status: 'free', locations: ['TLF'], types: ['Sägen'] }))).toBe(3)
    expect(materialFilterCount(prefs({ sort: 'type' }))).toBe(0)
    expect(isDefaultMaterialView(prefs({ sort: 'type' }))).toBe(false)
    expect(isDefaultMaterialView(DEFAULT_MATERIAL_VIEW)).toBe(true)
  })

  it('reject a stored value of another shape', () => {
    expect(isMaterialViewPrefs(DEFAULT_MATERIAL_VIEW)).toBe(true)
    expect(isMaterialViewPrefs({ ...DEFAULT_MATERIAL_VIEW, sort: 'name' })).toBe(false)
    expect(isMaterialViewPrefs({ ...DEFAULT_MATERIAL_VIEW, types: [1] })).toBe(false)
    expect(isMaterialViewPrefs(null)).toBe(false)
  })
})

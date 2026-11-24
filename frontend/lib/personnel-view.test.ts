import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  DEFAULT_PERSONNEL_VIEW,
  isDefaultView,
  isPersonnelViewPrefs,
  personnelFacets,
  viewPersonnel,
  type PersonnelViewPrefs,
  type ViewablePerson,
} from './personnel-view'

// Roster order: Oblt 10 < Wm 40 < Kpl 50 (the station's own `role_sort_order`).
const ROSTER: ViewablePerson[] = [
  { name: 'Zeller Ueli', role: 'Kpl', roleSortOrder: 50, tags: ['F'] },
  { name: 'Brunner Sarah', role: 'Wm', roleSortOrder: 40, tags: ['F', 'Hö'], isReko: true },
  { name: 'Aebi Nina', role: 'Oblt', roleSortOrder: 10, tags: [] },
  { name: 'Koch René', role: 'Wm', roleSortOrder: 40, tags: ['F'], status: 'assigned' },
  { name: 'Gast Paul', role: null, tags: ['Hö'] },
]

const prefs = (over: Partial<PersonnelViewPrefs>): PersonnelViewPrefs => ({ ...DEFAULT_PERSONNEL_VIEW, ...over })
const names = (people: readonly { name: string }[]) => people.map((p) => p.name)

describe('viewPersonnel', () => {
  it('keeps today’s Frei / Gebunden groups by default, by name inside each', () => {
    const { layout } = viewPersonnel(ROSTER, DEFAULT_PERSONNEL_VIEW)
    expect(layout).toEqual({
      kind: 'grouped',
      free: [ROSTER[2], ROSTER[4], ROSTER[0]],
      bound: [ROSTER[1], ROSTER[3]],
    })
  })

  it('sorts flat by roster order, then name', () => {
    const { layout } = viewPersonnel(ROSTER, prefs({ sort: 'rank' }))
    expect(layout.kind === 'flat' && names(layout.people)).toEqual([
      'Gast Paul', // no Grad sorts as 0, ahead of the ranked
      'Aebi Nina',
      'Brunner Sarah',
      'Koch René',
      'Zeller Ueli',
    ])
  })

  it('sorts flat by name', () => {
    const { layout } = viewPersonnel(ROSTER, prefs({ sort: 'name' }))
    expect(layout.kind === 'flat' && names(layout.people)).toEqual(names([...ROSTER].sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))))
  })

  it('reads Frei / Gebunden through isPersonOccupied (Reko is bound)', () => {
    expect(names(viewPersonnel(ROSTER, prefs({ status: 'bound' })).shown)).toEqual(['Brunner Sarah', 'Koch René'])
    expect(names(viewPersonnel(ROSTER, prefs({ status: 'free' })).shown)).toEqual(['Aebi Nina', 'Gast Paul', 'Zeller Ueli'])
  })

  it('matches one of the chosen grades, and «no Grad» is a grade of its own', () => {
    expect(names(viewPersonnel(ROSTER, prefs({ grades: ['Wm', ''] })).shown)).toEqual([
      'Gast Paul',
      'Brunner Sarah',
      'Koch René',
    ])
  })

  it('matches all of the chosen tags', () => {
    expect(names(viewPersonnel(ROSTER, prefs({ tags: ['F', 'Hö'] })).shown)).toEqual(['Brunner Sarah'])
  })

  it('combines status, grade and tags', () => {
    expect(names(viewPersonnel(ROSTER, prefs({ status: 'free', grades: ['Kpl', 'Wm'], tags: ['F'] })).shown)).toEqual([
      'Zeller Ueli',
    ])
  })
})

describe('personnelFacets', () => {
  it('counts over everybody it is given, grades in roster order, tags most used first', () => {
    const facets = personnelFacets(ROSTER, prefs({ grades: ['Wm'] }))
    expect(facets.status).toEqual({ all: 5, free: 3, bound: 2 })
    expect(facets.grades).toEqual([
      { key: '', count: 1 },
      { key: 'Oblt', count: 1 },
      { key: 'Wm', count: 2 },
      { key: 'Kpl', count: 1 },
    ])
    expect(facets.tags).toEqual([
      { tag: 'F', count: 3 },
      { tag: 'Hö', count: 2 },
    ])
  })

  it('keeps a remembered choice nobody carries, with 0, so it can be unticked', () => {
    const facets = personnelFacets(ROSTER, prefs({ grades: ['Lt'], tags: ['Atemschutz'] }))
    expect(facets.grades.at(-1)).toEqual({ key: 'Lt', count: 0 })
    expect(facets.tags.at(-1)).toEqual({ tag: 'Atemschutz', count: 0 })
  })
})

describe('prefs', () => {
  it('counts chosen values, not the sort', () => {
    expect(activeFilterCount(prefs({ status: 'free', grades: ['Wm', 'Kpl'], sort: 'rank' }))).toBe(3)
    expect(isDefaultView(prefs({ sort: 'rank' }))).toBe(false)
    expect(isDefaultView(DEFAULT_PERSONNEL_VIEW)).toBe(true)
  })

  it('rejects a stored value of the wrong shape', () => {
    expect(isPersonnelViewPrefs(DEFAULT_PERSONNEL_VIEW)).toBe(true)
    expect(isPersonnelViewPrefs({ ...DEFAULT_PERSONNEL_VIEW, sort: 'age' })).toBe(false)
    expect(isPersonnelViewPrefs({ ...DEFAULT_PERSONNEL_VIEW, grades: [1] })).toBe(false)
    expect(isPersonnelViewPrefs(null)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { pickerRows, type FeldAddPickerItem } from '@/components/feld/feld-add-picker'

const items: FeldAddPickerItem[] = [
  { key: 'p1', name: 'Meier Daniel', group: 'Heute anwesend' },
  { key: 'p2', name: 'Meier Sandra', group: 'Alle' },
  { key: 'p3', name: 'Meienberg Lukas', group: 'Alle' },
  { key: 'p4', name: 'Suter Elias', group: 'Alle' },
]

describe('pickerRows', () => {
  it('narrows by name in any case and keeps the groups in order', () => {
    const { groups } = pickerRows(items, 'mei', { allowFreeText: true })
    expect(groups.map(group => [group.label, group.items.map(item => item.key)])).toEqual([
      ['Heute anwesend', ['p1']],
      ['Alle', ['p2', 'p3']],
    ])
  })

  it('finds a person row by Grad and tags, like every person picker', () => {
    const people: FeldAddPickerItem[] = [
      { key: 'p1', name: 'Meier Daniel', person: { name: 'Meier Daniel', role: 'Gefreiter', tags: ['Atemschutz'] } },
      { key: 'p2', name: 'Suter Elias', person: { name: 'Suter Elias', role: 'Soldat', tags: [] } },
    ]
    const keys = (search: string) => pickerRows(people, search, { allowFreeText: false }).groups.flatMap(group => group.items.map(item => item.key))
    expect(keys('atemschutz')).toEqual(['p1'])
    expect(keys('soldat')).toEqual(['p2'])
  })

  it('offers what was typed as a free row when it names nobody exactly', () => {
    expect(pickerRows(items, '  Mei ', { allowFreeText: true }).freeText).toBe('Mei')
  })

  it('offers no free row for an exact match, a name already in the section, or a section without free text', () => {
    expect(pickerRows(items, 'meier sandra', { allowFreeText: true }).freeText).toBeNull()
    expect(pickerRows(items, 'Bräm Urs', { allowFreeText: true, takenNames: ['bräm urs'] }).freeText).toBeNull()
    expect(pickerRows(items, 'Pikett-Auto', { allowFreeText: false }).freeText).toBeNull()
    expect(pickerRows(items, '   ', { allowFreeText: true }).freeText).toBeNull()
  })
})

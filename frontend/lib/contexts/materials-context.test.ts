import { describe, expect, it } from 'vitest'
import { withAuftragDeployment, type Material } from './materials-context'
import { materialResourceState, summarizeMaterials } from '@/lib/resource-status'

function material(id: string, extra: Partial<Material> = {}): Material {
  return {
    id,
    name: id,
    category: 'Magazin',
    type: 'Pumpen',
    status: 'available',
    outOfService: false,
    outOfServiceSince: null,
    categorySortOrder: 0,
    consumable: false,
    groupId: null,
    ...extra,
  }
}

describe('withAuftragDeployment', () => {
  it('counts material held by an Auftrag as gebunden, like material on an Einsatz', () => {
    const depot = [material('pump'), material('free'), material('on-incident', { status: 'assigned' })]
    const folded = withAuftragDeployment(depot, new Set(['pump']))
    expect(folded.map(materialResourceState)).toEqual(['assigned', 'available', 'assigned'])
    expect(summarizeMaterials(folded)).toEqual({ free: 1, bound: 2, total: 3 })
  })

  it('keeps readiness first: an out-of-service device on an Auftrag stays nicht verfügbar', () => {
    const [folded] = withAuftragDeployment([material('broken', { outOfService: true })], new Set(['broken']))
    expect(materialResourceState(folded)).toBe('unavailable')
  })

  it('keeps a consumable frei – stock is not lent out', () => {
    const [folded] = withAuftragDeployment([material('oel', { consumable: true })], new Set(['oel']))
    expect(materialResourceState(folded)).toBe('available')
  })

  it('returns the rows it does not touch as they were (memoised rows stay memoised)', () => {
    const depot = [material('a'), material('b')]
    expect(withAuftragDeployment(depot, new Set())).toBe(depot)
    const folded = withAuftragDeployment(depot, new Set(['a']))
    expect(folded[1]).toBe(depot[1])
    expect(folded[0]).not.toBe(depot[0])
  })
})

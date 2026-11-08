import { describe, expect, it } from 'vitest'
import { clusterLead, clusterPins, type ClusterPin } from './map-clusters'

const SIZES = { pinSize: 32, bubbleSize: 44 }

function pin(id: string, x: number, y: number, extra: Partial<ClusterPin> = {}): ClusterPin {
  return { id, x, y, priority: 'low', statusGroup: 'active', ...extra }
}

const ids = (clusters: ReturnType<typeof clusterPins>) => clusters.map((c) => c.pins.map((p) => p.id).sort())

describe('clusterPins', () => {
  it('leaves pins that stand apart alone', () => {
    expect(clusterPins([pin('a', 0, 0), pin('b', 100, 0), pin('c', 0, 100)], SIZES)).toEqual([])
  })

  it('merges two pins that overlap into one bubble', () => {
    expect(ids(clusterPins([pin('a', 0, 0), pin('b', 20, 0), pin('far', 300, 300)], SIZES))).toEqual([['a', 'b']])
  })

  it('also merges pins that only touch within the gap – a finger cannot tell them apart', () => {
    expect(ids(clusterPins([pin('a', 0, 0), pin('b', 34, 0)], SIZES))).toEqual([['a', 'b']])
    expect(clusterPins([pin('a', 0, 0), pin('b', 40, 0)], SIZES)).toEqual([])
  })

  it('pulls a pin the grown bubble now lies on into it', () => {
    // a+b merge at x=10; the 44px bubble then reaches c at x=48 (22 + 16 + 4 > 38).
    expect(ids(clusterPins([pin('a', 0, 0), pin('b', 20, 0), pin('c', 48, 0)], SIZES))).toEqual([['a', 'b', 'c']])
  })

  it('counts a same-address pin as all of its incidents', () => {
    const [cluster] = clusterPins([pin('coop', 0, 0, { count: 3 }), pin('b', 20, 0)], SIZES)
    expect(cluster.count).toBe(4)
  })

  it('sizes a same-address pin as a pin, not as a bubble', () => {
    // 38px apart: two 32px pins clear each other (16 + 16 + 4 < 38) – a bubble's 22 would not.
    expect(clusterPins([pin('coop', 0, 0, { count: 3 }), pin('b', 38, 0)], SIZES)).toEqual([])
  })

  it('gives the same bubbles whatever order the pins arrive in', () => {
    const pins = [pin('a', 0, 0), pin('b', 20, 0), pin('c', 200, 0), pin('d', 215, 10)]
    expect(ids(clusterPins(pins, SIZES))).toEqual(ids(clusterPins([...pins].reverse(), SIZES)))
  })
})

describe('clusterLead', () => {
  it('speaks for the highest priority', () => {
    const lead = clusterLead([pin('n', 0, 0, { priority: 'low' }), pin('h', 0, 0, { priority: 'high' }), pin('m', 0, 0, { priority: 'medium' })])
    expect(lead.id).toBe('h')
  })

  it('ranks a pin without priority below Niedrig', () => {
    expect(clusterLead([pin('none', 0, 0, { priority: null }), pin('low', 0, 0)]).id).toBe('low')
  })

  it('between equal priorities takes the most pressing status: Offen before Aktiv before Rückfahrt', () => {
    const lead = clusterLead([
      pin('done', 0, 0, { priority: 'high', statusGroup: 'completed' }),
      pin('out', 0, 0, { priority: 'high', statusGroup: 'active' }),
      pin('waiting', 0, 0, { priority: 'high', statusGroup: 'open' }),
    ])
    expect(lead.id).toBe('waiting')
  })

  it('is the bubble’s lead', () => {
    const [cluster] = clusterPins([pin('a', 0, 0), pin('b', 10, 0, { priority: 'high' })], SIZES)
    expect(cluster.lead.id).toBe('b')
  })
})

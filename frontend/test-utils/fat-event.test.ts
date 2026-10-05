import { describe, expect, it } from 'vitest'
import { FAT_PRESETS, actionMix, fatEvent, type FatAction } from './fat-event'

// The generator is only worth something while it stays calibrated against the record
// (29.06.2026: 63 Einsätze, 431 actions in 2 h — see the header of fat-event.ts).
describe('fatEvent', () => {
  it('is deterministic', () => {
    expect(fatEvent({ seed: 7 })).toEqual(fatEvent({ seed: 7 }))
  })

  it('`real` matches the busiest session on record', () => {
    const fat = fatEvent(FAT_PRESETS.real)
    const mix = actionMix(fat.actions)
    expect(fat.incidents).toBe(63)
    const userActions = fat.actions.filter((a) => a.kind !== 'checkIn' && a.kind !== 'create').length
    expect(userActions).toBeGreaterThan(431 * 0.75)
    expect(userActions).toBeLessThan(431 * 1.25)
    expect(mix['assign personnel']).toBeGreaterThan(85 * 0.7)
    expect(mix['assign personnel']).toBeLessThan(85 * 1.3)
    expect(fat.roster).toEqual({ personnel: 67, vehicles: 5, materials: 39 })
  })

  it('never double-books a resource or touches an unknown assignment', () => {
    for (const preset of Object.values(FAT_PRESETS)) {
      const fat = fatEvent(preset)
      const busy = new Set<string>()
      const slots = new Map<string, string>()
      const slotIncident = new Map<string, number>()
      const created = new Set<number>()
      const done = new Set<number>()
      for (const a of fat.actions as FatAction[]) {
        if (a.kind === 'create') created.add(a.incident)
        else if (a.kind === 'assign') {
          expect(created.has(a.incident) && !done.has(a.incident)).toBe(true)
          const key = `${a.resource}:${a.index}`
          expect(busy.has(key)).toBe(false)
          busy.add(key)
          slots.set(`${a.writer}:${a.slot}`, key)
          slotIncident.set(`${a.writer}:${a.slot}`, a.incident)
        } else if (a.kind === 'unassign') {
          const key = slots.get(`${a.writer}:${a.slot}`)
          expect(key).toBeDefined()
          busy.delete(key!)
          slots.delete(`${a.writer}:${a.slot}`)
        } else if (a.kind === 'status' && a.to === 'complete') {
          done.add(a.incident)
          // the backend releases the whole crew on completion
          for (const [s, key] of slots) if (slotIncident.get(s) === a.incident) { busy.delete(key); slots.delete(s) }
        }
      }
    }
  })

  it('grows the board with hours and the roster with scale', () => {
    const real = fatEvent(FAT_PRESETS.real)
    const long = fatEvent(FAT_PRESETS.long)
    const large = fatEvent(FAT_PRESETS.large)
    expect(long.incidents).toBe(real.incidents * 6)
    expect(long.roster).toEqual(real.roster)
    expect(large.roster.personnel).toBe(real.roster.personnel * 4)
    expect(large.writers).toBe(real.writers * 4)
  })
})

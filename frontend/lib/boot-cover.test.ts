import { beforeEach, describe, expect, it } from 'vitest'

import { bootGates } from './boot-cover'

beforeEach(() => bootGates.reset())

describe('boot gates', () => {
  it('are closed with no gate at all — a page that has not registered yet must not lift the cover', () => {
    expect(bootGates.snapshot().open).toBe(false)
  })

  it('open only when every registered gate is ready', () => {
    bootGates.set('session', { ready: true, rank: 0 })
    bootGates.set('board', { ready: false, label: 'Einsätze werden geladen …', rank: 1 })
    expect(bootGates.snapshot()).toEqual({ open: false, label: 'Einsätze werden geladen …' })
    bootGates.set('board', { ready: true, label: 'Einsätze werden geladen …', rank: 1 })
    expect(bootGates.snapshot().open).toBe(true)
  })

  it('name the most basic gate still holding (the session before the data)', () => {
    bootGates.set('board', { ready: false, label: 'Einsätze werden geladen …', rank: 1 })
    bootGates.set('session', { ready: false, label: 'Anmeldung wird vorbereitet …', rank: 0 })
    expect(bootGates.snapshot().label).toBe('Anmeldung wird vorbereitet …')
  })

  it('forget a gate whose page unmounts', () => {
    bootGates.set('session', { ready: true, rank: 0 })
    bootGates.set('map', { ready: false, rank: 1 })
    bootGates.remove('map')
    expect(bootGates.snapshot().open).toBe(true)
  })

  it('keep a stable snapshot while nothing changes (useSyncExternalStore)', () => {
    bootGates.set('session', { ready: true, rank: 0 })
    const a = bootGates.snapshot()
    bootGates.set('session', { ready: true, rank: 0 })
    expect(bootGates.snapshot()).toBe(a)
  })

  it('keep the last phase once open, so the fade does not read as the start beginning again', () => {
    bootGates.set('board', { ready: false, label: 'Einsätze werden geladen …', rank: 1 })
    bootGates.set('board', { ready: true, label: 'Einsätze werden geladen …', rank: 1 })
    expect(bootGates.snapshot()).toEqual({ open: true, label: 'Einsätze werden geladen …' })
  })
})

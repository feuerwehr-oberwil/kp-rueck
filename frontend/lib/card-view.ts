'use client'

/**
 * What a kanban card shows — the operator's own decision, per device.
 *
 * This replaces the two hand-rolled footer pills ("Meldung", "Reko"). The board
 * is read at very different distances: the KP on the main screen wants the crew
 * names, the second screen on the wall wants forty addresses at once. So the
 * card body is a set of switches, with three presets for the common answers.
 *
 * Two rules the shape encodes:
 *
 *  1. **Only detail is switchable.** The address, the priority marker and every
 *     warning/status chip (Abholung, Rapport, the field-status nudge) are NOT in
 *     `CARD_VIEW_KEYS` and never will be — nobody gets to configure a hazard off
 *     their board.
 *  2. **A preset is a starting point, not a mode.** Picking one writes all nine
 *     switches; flipping a switch afterwards changes that switch and nothing
 *     else. There is no snap-back, because a card that silently re-grows a block
 *     you just closed is worse than no presets at all.
 *
 * Storage is per device (localStorage), like the incident time mode and the
 * language: two workstations on one incident must be able to disagree, and one
 * operator's click must never repaint the other's board mid-Einsatz.
 */

import { useSyncExternalStore } from 'react'

import { readItem, readJson, writeJson } from '@/lib/utils/safe-storage'

/**
 * The switchable blocks, in the order they appear on the card.
 *
 * `CardViewSettings` is DERIVED from this list on purpose: a new flag cannot
 * exist without being in `CARD_VIEW_KEYS`, which is what `cardViewEquals` — and
 * therefore the card's memo comparator — iterates. That closes the one failure
 * mode of a hand-written comparator: a flag that toggles but never repaints.
 */
export const CARD_VIEW_KEYS = [
  'einsatzart',
  'zeiten',
  'meldung',
  'melder',
  'mannschaft',
  'fahrzeuge',
  'material',
  'auftrag',
  'reko',
] as const

export type CardViewKey = (typeof CARD_VIEW_KEYS)[number]

export type CardViewSettings = Record<CardViewKey, boolean>

export type CardViewPreset = 'kompakt' | 'standard' | 'alles'

export const CARD_VIEW_PRESET_ORDER: readonly CardViewPreset[] = ['kompakt', 'standard', 'alles']

function fill(value: boolean): CardViewSettings {
  return Object.fromEntries(CARD_VIEW_KEYS.map((key) => [key, value])) as CardViewSettings
}

/**
 * Kompakt = header only (address, priority, status chips).
 * Standard = exactly what the board did before this control existed — every
 *   block except "Melder", which the card never rendered.
 * Alles = everything, including the reporting person and their number.
 */
export const CARD_VIEW_PRESETS: Record<CardViewPreset, CardViewSettings> = {
  kompakt: fill(false),
  standard: { ...fill(true), melder: false },
  alles: fill(true),
}

export const DEFAULT_CARD_VIEW: CardViewSettings = CARD_VIEW_PRESETS.standard

/** True when every switch matches. Used by the card's memo comparator. */
export function cardViewEquals(a: CardViewSettings, b: CardViewSettings): boolean {
  if (a === b) return true
  return CARD_VIEW_KEYS.every((key) => a[key] === b[key])
}

/** Which preset these settings are, or `null` for a custom set. Display only. */
export function matchCardViewPreset(view: CardViewSettings): CardViewPreset | null {
  return CARD_VIEW_PRESET_ORDER.find((preset) => cardViewEquals(CARD_VIEW_PRESETS[preset], view)) ?? null
}

/** Flip one switch. Never touches the others — see rule 2 above. */
export function toggleCardViewKey(view: CardViewSettings, key: CardViewKey): CardViewSettings {
  return { ...view, [key]: !view[key] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Tolerates an object written by an older build with fewer keys: unknown keys
 * fall back to the default rather than to `false`, so a version bump never
 * silently blanks somebody's cards.
 */
export function coerceCardView(value: unknown): CardViewSettings | null {
  if (!isRecord(value)) return null
  const known = CARD_VIEW_KEYS.filter((key) => typeof value[key] === 'boolean')
  if (known.length === 0) return null
  const merged = { ...DEFAULT_CARD_VIEW }
  for (const key of known) merged[key] = value[key] as boolean
  return merged
}

export const CARD_VIEW_STORAGE_KEY = 'kp-board-cardView'

/** The two pills this control replaced. Read once, so nobody's board changes under them. */
const LEGACY_MELDUNG_KEY = 'showMeldung'
const LEGACY_REKO_KEY = 'showReko'

let view: CardViewSettings = DEFAULT_CARD_VIEW
let initialised = false

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function set(next: CardViewSettings) {
  if (cardViewEquals(next, view)) return
  view = next
  emit()
}

function readStored(): CardViewSettings | null {
  const stored = readJson(CARD_VIEW_STORAGE_KEY, isRecord, null)
  if (stored !== null) {
    const coerced = coerceCardView(stored)
    if (coerced) return coerced
  }
  // Migration: an operator who had turned the old pills off keeps that board.
  const meldung = readItem(LEGACY_MELDUNG_KEY)
  const reko = readItem(LEGACY_REKO_KEY)
  if (meldung === null && reko === null) return null
  return {
    ...DEFAULT_CARD_VIEW,
    meldung: meldung !== 'false',
    reko: reko !== 'false',
  }
}

/**
 * Runs from `subscribe`, i.e. AFTER the first client render has committed — so
 * the hydration render sees `DEFAULT_CARD_VIEW`, the same thing the server sent,
 * and a stored preference arrives as a normal update instead of a mismatch.
 */
function initialise() {
  if (initialised) return
  initialised = true

  const stored = readStored()
  if (stored) set(stored)

  // The board on one monitor and the display on the next are separate tabs of
  // one device; a view change on either should reach both.
  window.addEventListener('storage', (event) => {
    if (event.key !== CARD_VIEW_STORAGE_KEY) return
    if (event.newValue === null) {
      set(DEFAULT_CARD_VIEW)
      return
    }
    try {
      const parsed = coerceCardView(JSON.parse(event.newValue))
      if (parsed) set(parsed)
    } catch {
      // Another tab wrote something unusable — keep what we have.
    }
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  initialise()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): CardViewSettings {
  return view
}

/**
 * Nothing on the Next server calls `initialise` or `setCardView`, so the module
 * value there is always the default and hydration matches.
 */
function getServerSnapshot(): CardViewSettings {
  return view
}

/** Persist and broadcast a full settings object. */
export function setCardView(next: CardViewSettings): void {
  writeJson(CARD_VIEW_STORAGE_KEY, next)
  set(next)
}

export function useCardView(): {
  view: CardViewSettings
  /** Stable identity while the settings don't change — safe to hand to a memo. */
  setView: (next: CardViewSettings) => void
  applyPreset: (preset: CardViewPreset) => void
  toggleKey: (key: CardViewKey) => void
  preset: CardViewPreset | null
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return {
    view: current,
    setView: setCardView,
    applyPreset: (preset) => setCardView(CARD_VIEW_PRESETS[preset]),
    toggleKey: (key) => setCardView(toggleCardViewKey(current, key)),
    preset: matchCardViewPreset(current),
  }
}

/** Test seam: drop module state so each case starts from a clean board. */
export function __resetCardViewForTests(): void {
  view = DEFAULT_CARD_VIEW
  initialised = false
  listeners.clear()
}

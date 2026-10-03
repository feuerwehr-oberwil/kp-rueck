'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * The launch cover's release conditions (components/boot-cover.tsx).
 *
 * Owner, 03.10.2026: «the snail animation is first and then there is the loading animation to
 * load the emergency itself. I want the snail to block the stuff in the background so we have a
 * full / clean workspace to work with.» So on a launch the boot snail stays over the whole app
 * until the route it landed on is actually usable, then lifts once. KP Front's rule, there in
 * lib/bootCover: «An Einsatz opens behind the snail».
 *
 * «Usable» is said by the pieces that know it, as GATES: ProtectedRoute (the session is decided),
 * the board (its first load is in), the Lagekarte (its first `idle`), the Feld page (its data).
 * Each one registers while it is mounted and flips `ready`; the cover lifts when there is at
 * least one gate and every gate is ready. A gate registers in a layout effect, so a page that
 * mounts in the same commit as the one that opened its parent's gate is counted before the
 * cover looks again.
 */

export interface BootGate {
  ready: boolean
  /** What the cover says while this gate holds it («Einsätze werden geladen …»). */
  label?: string
  /** Lower first: the session before the data, so the phase reads in launch order. */
  rank: number
}

const gates = new Map<string, BootGate>()
const listeners = new Set<() => void>()

export interface BootGatesSnapshot {
  /** At least one gate, and all of them ready. */
  open: boolean
  /** The label of the most basic gate still holding, if it has one. */
  label?: string
}

const NONE: BootGatesSnapshot = { open: false }
let snapshot: BootGatesSnapshot = NONE

function recompute() {
  let open = gates.size > 0
  let holding: BootGate | undefined
  for (const gate of gates.values()) {
    if (gate.ready) continue
    open = false
    if (!holding || gate.rank < holding.rank) holding = gate
  }
  // Once open, keep saying what was last loading: the cover still has a frame and a fade to
  // go, and falling back to the first phase there read as the start beginning again.
  const label = holding?.label ?? (open ? snapshot.label : undefined)
  if (snapshot.open !== open || snapshot.label !== label) snapshot = { open, label }
  listeners.forEach((listener) => listener())
}

export const bootGates = {
  set(key: string, gate: BootGate) {
    gates.set(key, gate)
    recompute()
  },
  remove(key: string) {
    if (gates.delete(key)) recompute()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  snapshot: () => snapshot,
  serverSnapshot: () => NONE,
  /** Tests only. */
  reset() {
    gates.clear()
    snapshot = NONE
    coverUp = true
    arm = UNARMED
  },
}

/**
 * Whether the launch cover is (still) up. Starts true: the server only ever renders a launch,
 * and the client's first render must agree with it; BootCover clears it once it is gone, or at
 * once on a launch it does not cover. A boot stage below the cover renders nothing while it is
 * up — one snail on screen, not a second one hidden under the first.
 */
let coverUp = true
const coverListeners = new Set<() => void>()

/** A launch that starts inside the app: «signed in» on the login page → the first workspace. */
export interface LaunchArm {
  /** 0 = never armed. */
  seq: number
  /** The page that armed it (it lies under the cover until the app has moved on). */
  path: string | null
  /** performance.now() at arming — the cap counts from here. */
  at: number
}
const UNARMED: LaunchArm = { seq: 0, path: null, at: 0 }
let arm: LaunchArm = UNARMED

export const launchCover = {
  isUp: () => coverUp,
  set(up: boolean) {
    if (coverUp === up) return
    coverUp = up
    coverListeners.forEach((listener) => listener())
  },
  /**
   * Treat what follows as a launch: the cover comes up again over `fromPath` and stays until
   * the workspace the app moves on to is usable (the same gates), then fades once. Called by
   * the login page the moment the sign-in has succeeded, before it navigates — a password or
   * demo login is a client-side page change, and without this the board assembled itself in
   * view with its in-app loaders. Its snail continues the launch's clock.
   */
  arm(fromPath: string) {
    arm = { seq: arm.seq + 1, path: fromPath, at: performance.now() }
    coverUp = true
    coverListeners.forEach((listener) => listener())
  },
  armSnapshot: () => arm,
  armServerSnapshot: () => UNARMED,
  subscribe(listener: () => void) {
    coverListeners.add(listener)
    return () => {
      coverListeners.delete(listener)
    }
  },
}

export function useLaunchArm(): LaunchArm {
  return useSyncExternalStore(launchCover.subscribe, launchCover.armSnapshot, launchCover.armServerSnapshot)
}

export function useLaunchCoverUp(): boolean {
  return useSyncExternalStore(launchCover.subscribe, launchCover.isUp, () => true)
}

/** Hold the launch cover until `ready`. Harmless after the launch: nothing is listening. */
export function useBootGate(key: string, ready: boolean, label?: string, rank = 1) {
  useLayoutEffect(() => {
    bootGates.set(key, { ready, label, rank })
  }, [key, ready, label, rank])
  useLayoutEffect(() => () => bootGates.remove(key), [key])
}

export function useBootGates(): BootGatesSnapshot {
  return useSyncExternalStore(bootGates.subscribe, bootGates.snapshot, bootGates.serverSnapshot)
}

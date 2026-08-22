"use client"

import { useEffect, type RefObject } from "react"

import type { Operation } from "@/lib/contexts/operations-context"
import { readJson, writeJson } from "@/lib/utils/safe-storage"

interface AvailableVehicle {
  id: string
  name: string
  type: string
}

interface UseOperationDetailShortcutsParams {
  /** Modal open state — listener only attaches while true. */
  enabled: boolean
  /** The incident the modal is bound to. */
  operation: Operation | null
  /** Vehicles in the modal's quick-assign list (max 5 used). */
  availableVehicles: AvailableVehicle[]
  onUpdate: (updates: Partial<Operation>) => void
  onAssignVehicle: (vehicleId: string, vehicleName: string, operationId: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
}

const SHIFT_PRIORITY_KEYS: Record<string, Operation["priority"]> = {
  "1": "low",
  "!": "low",
  "2": "medium",
  "@": "medium",
  "3": "high",
  "#": "high",
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLElement && target.getAttribute("role") === "combobox") return true
  return false
}

/**
 * Wires the operation-detail modal's keyboard shortcuts:
 *   Shift+1 / Shift+2 / Shift+3 — set priority low / medium / high
 *   0                            — toggle "zu Fuss"
 *   1..5                         — assign or remove the Nth quick-assign vehicle
 *
 * Listener is detached whenever `enabled` flips false or the modal unmounts,
 * so shortcuts can't fire while the modal is closed.
 */
export function useOperationDetailShortcuts({
  enabled,
  operation,
  availableVehicles,
  onUpdate,
  onAssignVehicle,
  onRemoveVehicle,
}: UseOperationDetailShortcutsParams): void {
  useEffect(() => {
    if (!enabled || !operation) return

    const handleKeyPress = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      if (event.shiftKey) {
        const priority = SHIFT_PRIORITY_KEYS[event.key]
        if (priority) {
          event.preventDefault()
          onUpdate({ priority })
          return
        }
      }

      if (event.key === "0" && !event.shiftKey) {
        event.preventDefault()
        onUpdate({ zuFuss: !operation.zuFuss })
        return
      }

      const vehicleIndex = Number.parseInt(event.key, 10) - 1
      if (
        !Number.isNaN(vehicleIndex) &&
        vehicleIndex >= 0 &&
        vehicleIndex < 5 &&
        vehicleIndex < availableVehicles.length
      ) {
        const vehicle = availableVehicles[vehicleIndex]
        if (!vehicle) return
        event.preventDefault()
        const isAssigned = operation.vehicles.includes(vehicle.name)
        if (isAssigned) {
          onRemoveVehicle(operation.id, vehicle.name)
        } else {
          onAssignVehicle(vehicle.id, vehicle.name, operation.id)
        }
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [enabled, operation, availableVehicles, onUpdate, onAssignVehicle, onRemoveVehicle])
}

/** The three tabs of the incident detail. Declared here, next to the shortcuts,
 *  because the shortcuts are what decide which tab has to be in front.
 *
 *  Ressourcen used to be a fourth. It was folded into Übersicht: what an
 *  incident IS and who is on it is one question an operator asks in one look,
 *  and splitting it cost a tab switch every time. */
export type OperationDetailTab = "overview" | "reko" | "rapport" | "history"

/** Left-to-right, the order the tab bar shows them in — and therefore the order
 *  ← / → walk through. */
export const OPERATION_DETAIL_TABS: readonly OperationDetailTab[] = ["overview", "reko", "rapport", "history"]

/** A block INSIDE a tab worth landing on directly, for a caller that pointed at
 *  something more specific than the tab — a click on the kanban card's crew or
 *  material row, say.
 *
 *  * `resources` — Übersicht's Ressourcen block, which in the 420px panel sits
 *    a long way below the form.
 *  * `newReport` — the Reko tab with its entry form already OPEN. «Reko-Details
 *    öffnen» in the completion gate is an answer to "there is no Reko report",
 *    so landing on a tab with a «Reko-Bericht erstellen» button still to find
 *    is one click short of what the button promised.
 *  * `kurzbericht` — the Rapport tab with the cursor already in the Kurzbericht.
 *    Only for the paths that mean to WRITE one (taking a correction over the
 *    radio, a Schadenplatz that has no Rapport yet). Opening the same tab to
 *    READ — clicking a Feldmeldung in the bell, or the green icon on a card
 *    that already has a Rapport — must not steal the caret, or the operator
 *    types their next keyboard shortcut into somebody's Kurzbericht. */
export type OperationDetailSection = "resources" | "newReport" | "kurzbericht"

function isDetailTab(value: unknown): value is OperationDetailTab {
  return typeof value === "string" && (OPERATION_DETAIL_TABS as readonly string[]).includes(value)
}

/**
 * Which tab each incident was last left on.
 *
 * One key holding a most-recent-first list, not a key per incident: a storm
 * night has forty Schadenplätze and localStorage has no expiry, so a key per
 * incident is an unbounded map nobody ever cleans up. The list is capped, which
 * makes the oldest entry fall off by itself — and the thing being forgotten is
 * "which tab was I on", the cheapest possible loss.
 */
const TAB_MEMORY_KEY = "kp-rueck:incident-detail-tabs"
const TAB_MEMORY_LIMIT = 40

type TabMemoryEntry = [incidentId: string, tab: OperationDetailTab]

function isTabMemory(value: unknown): value is TabMemoryEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && isDetailTab(entry[1]),
    )
  )
}

/**
 * The tab this incident was last left on, or `null`.
 *
 * `null` for an unknown incident **and** for a stored value that is no longer a
 * tab — Ressourcen was one until it was folded into Übersicht, and a stale
 * entry must land the operator on Übersicht, never on a blank panel.
 */
export function readRememberedTab(incidentId: string): OperationDetailTab | null {
  const stored = readJson<TabMemoryEntry[], null>(TAB_MEMORY_KEY, isTabMemory, null)
  if (!stored) return null
  const entry = stored.find(([id]) => id === incidentId)
  return entry ? entry[1] : null
}

/** Remember it, most recent first, capped. Failure is silent by design. */
export function rememberDetailTab(incidentId: string, tab: OperationDetailTab): void {
  const stored = readJson<TabMemoryEntry[], null>(TAB_MEMORY_KEY, isTabMemory, null) ?? []
  const entry: TabMemoryEntry = [incidentId, tab]
  const next = [entry, ...stored.filter(([id]) => id !== incidentId)].slice(0, TAB_MEMORY_LIMIT)
  writeJson(TAB_MEMORY_KEY, next)
}

/**
 * Which tab holds the control a shortcut key manipulates — `null` when the key
 * is none of ours.
 *
 * The detail is tabbed, so a shortcut can aim at a control that is not on
 * screen: priority, "zu Fuss" and the quick-assign fleet all live on Übersicht
 * now, and a keypress fired from Rapport or Verlauf must bring that tab
 * forward, or the operator gets a silent mutation they cannot see. This
 * resolver shares its key matching with the handler above on purpose — one
 * table of keys, so the two cannot drift apart.
 */
export function resolveShortcutTab(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "target">,
  availableVehicleCount: number,
): OperationDetailTab | null {
  if (isTypingTarget(event.target)) return null

  if (event.shiftKey && SHIFT_PRIORITY_KEYS[event.key]) return "overview"

  if (event.key === "0" && !event.shiftKey) return "overview"

  const vehicleIndex = Number.parseInt(event.key, 10) - 1
  if (
    !Number.isNaN(vehicleIndex) &&
    vehicleIndex >= 0 &&
    vehicleIndex < 5 &&
    vehicleIndex < availableVehicleCount
  ) {
    return "overview"
  }

  return null
}

/** Widgets that own the arrow keys themselves. A Radix Select trigger, a
 *  listbox row or a slider would all react to ← / → on their own. */
const ARROW_OWNING_ROLES = new Set([
  "combobox",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "option",
  "radio",
  "radiogroup",
  "slider",
  "spinbutton",
  // Radix's own roving focus already walks the trigger list; handling it a
  // second time would skip a tab.
  "tab",
  "tablist",
])

/** Input types where ← / → move a caret through text. Everything else — time,
 *  number, date, range, checkbox — CHANGES ITS VALUE on an arrow key, so those
 *  never yield the keystroke. */
const CARET_INPUT_TYPES = new Set(["text", "search", "tel", "url", "email", "password", ""])

/**
 * Would this arrow key move a caret? Then it belongs to the caret.
 *
 * The rule that makes ← / → usable on a form-heavy tab: an arrow only means
 * "cursor movement" while there is something for the cursor to move over. With
 * a collapsed caret already at the start of the field, ← does nothing at all —
 * so it is free, and it switches the tab. As soon as there is a character in
 * that direction, or any selection to collapse, the field keeps it.
 */
function caretOwnsArrow(field: HTMLInputElement | HTMLTextAreaElement, step: -1 | 1): boolean {
  let start: number | null
  let end: number | null
  try {
    start = field.selectionStart
    end = field.selectionEnd
  } catch {
    // Some input types throw on selectionStart. If we cannot tell, the field
    // keeps its own key.
    return true
  }
  if (start === null || end === null) return true
  if (start !== end) return true
  return step === -1 ? start > 0 : end < field.value.length
}

/**
 * ← / → as tab navigation: -1, +1, or 0 for "not ours".
 *
 * Exported for the tests, because the interesting half of this feature is
 * exactly the set of cases where the answer is 0.
 */
export function resolveArrowTabStep(event: Pick<KeyboardEvent, "key" | "target" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">): -1 | 0 | 1 {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0
  const step: -1 | 0 | 1 = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0
  if (step === 0) return 0

  const target = event.target
  if (!(target instanceof HTMLElement)) return step

  const role = target.getAttribute("role")
  if (role && ARROW_OWNING_ROLES.has(role)) return 0
  if (target.closest('[role="tab"], [role="tablist"]')) return 0
  if (target.isContentEditable) return 0

  if (target instanceof HTMLTextAreaElement) return caretOwnsArrow(target, step) ? 0 : step
  if (target instanceof HTMLInputElement) {
    if (!CARET_INPUT_TYPES.has(target.type)) return 0
    return caretOwnsArrow(target, step) ? 0 : step
  }

  return step
}

/**
 * ← / → move between the detail's tabs from **anywhere inside it** — a button,
 * a switch, a half-typed Kurzbericht — not only from the tab bar, which is all
 * Radix's roving focus gives you.
 *
 * Scoped by containment rather than by a global listener: a keystroke aimed at
 * the command palette, a portalled Select or the board behind a side panel is
 * not aimed at these tabs. `focusTrapped` is the modal's exception — Radix
 * parks focus on the dialog shell (an ancestor of our root) the moment it
 * opens, and a keystroke from there is still a keystroke in the modal.
 *
 * **The panel is the same rule, not a weaker one.** It traps nothing: the board
 * behind it is live and Chrome spends an unclaimed ← / → scrolling
 * `#kanban-main` sideways, which is real behaviour worth keeping. So the panel
 * gets the keystroke on exactly the same terms as the modal — the event has to
 * come from inside it — and the panel earns that by taking focus when it is
 * touched (`focusPanelRoot` in `operation-detail-content.tsx`). Touch the board
 * again, anywhere, and the arrows go back to scrolling it. What must NOT happen
 * here is a "nobody has focus, so it is probably the panel" fallback: that would
 * silently delete the board's own arrow keys for as long as a card is selected.
 *
 * No wrap-around at the ends. → on the last tab does nothing, which reads as
 * "that is the end" rather than teleporting the operator back to the first.
 */
export function useOperationDetailTabArrows({
  enabled,
  tab,
  containerRef,
  focusTrapped,
  onFocusTab,
}: {
  enabled: boolean
  tab: OperationDetailTab
  containerRef: RefObject<HTMLElement | null>
  focusTrapped: boolean
  onFocusTab: (tab: OperationDetailTab) => void
}): void {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const root = containerRef.current
      if (!root) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (!root.contains(target) && !(focusTrapped && target.contains(root))) return

      const step = resolveArrowTabStep(event)
      if (step === 0) return
      const next = OPERATION_DETAIL_TABS[OPERATION_DETAIL_TABS.indexOf(tab) + step]
      if (!next) return
      event.preventDefault()
      onFocusTab(next)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [enabled, tab, containerRef, focusTrapped, onFocusTab])
}

/**
 * Keeps the visible tab in step with the shortcut keys. Purely a view concern —
 * it never mutates the incident, so it is safe to mount next to (or without)
 * `useOperationDetailShortcuts`.
 */
export function useOperationDetailShortcutTabs({
  enabled,
  availableVehicleCount,
  onFocusTab,
}: {
  enabled: boolean
  availableVehicleCount: number
  onFocusTab: (tab: OperationDetailTab) => void
}): void {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const tab = resolveShortcutTab(event, availableVehicleCount)
      if (tab) onFocusTab(tab)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [enabled, availableVehicleCount, onFocusTab])
}

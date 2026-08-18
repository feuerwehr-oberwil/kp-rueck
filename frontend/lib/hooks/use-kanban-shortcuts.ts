"use client"

import { useEffect } from "react"
import { toast } from "sonner"

import { translateOutsideReact } from "@/lib/i18n-messages"
import { openCommandPalette } from "@/components/ui/command-palette"
import type { Operation } from "@/lib/contexts/operations-context"
import type { UseGPrefixNavigation } from "./use-g-prefix-navigation"

interface VehicleType {
  /** Number key the user presses to toggle this vehicle (e.g. "1"). */
  key: string
  id: string
  name: string
}

export interface KanbanShortcutsState {
  /** True when any modal/dialog/sheet is open — disables every shortcut. */
  modalOpen: boolean
  /** Currently-hovered operation, if any — actions that need a target read this. */
  hoveredOperationId: string | null
  operations: Operation[]
  vehicleTypes: VehicleType[]
  /** g-prefix hook output; we forward keys to its state machine. */
  gPrefix: UseGPrefixNavigation
}

export interface KanbanShortcutsActions {
  /** Toggle a vehicle assignment on the hovered operation. */
  onToggleVehicle: (vehicle: VehicleType, operationId: string, isAssigned: boolean) => void
  /** Apply an arbitrary update to the hovered operation. */
  onUpdateOperation: (operationId: string, updates: Partial<Operation>) => void
  /** Move the hovered operation one column right (status forward). */
  onMoveRight: (operationId: string) => void
  /** Move the hovered operation one column left (status backward). */
  onMoveLeft: (operationId: string) => void
  /** Toggle zu_fuss flag on the hovered operation. */
  onToggleZuFuss: (operationId: string) => void
  /** Refresh all operations (toast-wrapped). */
  onRefresh: () => Promise<unknown>
  /** Open the detail modal for the hovered operation. */
  onOpenDetail: (operation: Operation) => void
  /** Stage an operation for delete confirmation. */
  onRequestDelete: (operation: Operation) => void
  /** Open the new-emergency modal. */
  onOpenNewEmergency: () => void
  /** Focus the global incident search input. */
  onFocusSearch: () => void
  /** Open + focus the personnel sidebar. */
  onFocusPersonnel: () => void
  /** Open + focus the material sidebar. */
  onFocusMaterial: () => void
  /** Toggle the vehicle status footer sheet. */
  onToggleVehicleFooter: () => void
  /** Toggle the Aufträge (routes) footer sheet. */
  onToggleAuftraege: () => void
  /** Toggle the personnel (left) sidebar visibility. */
  onToggleLeftSidebar: () => void
  /** Toggle the material (right) sidebar visibility. */
  onToggleRightSidebar: () => void
  /** Toggle the side panel collapsed/detail. */
  onToggleSidePanel: () => void
  /** Switch side panel to Detail view. No key binds to it — `d` used to, and
   *  now opens the Drucken-Sheet; it is reachable from the command palette
   *  only, which is why that entry advertises no shortcut. */
  onSidePanelDetail: () => void
  /** Opens/closes the one Drucken-Sheet (Thermodruck, Status drucken, Export). */
  onTogglePrint: () => void
  /** Opens/closes the Links & QR sheet (Check-In, Feld, Alarm, Anzeige). */
  onToggleLinks: () => void
  /** Switch side panel to Map view (no-op if collapsed). */
  onSidePanelMap: () => void
  /** Toggle the notification sidebar. */
  onToggleNotifications: () => void
}

/**
 * True when the event target is a field somebody is typing into — a bare `s`
 * must never be eaten out of one. Exported because every other keyboard
 * surface (the map, the wall display) needs exactly this rule.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const role = target.getAttribute("role")
  return role === "combobox" || role === "listbox" || role === "option"
}

/**
 * Elements for which Enter (or Space) is already the activation key. A
 * page-level Enter shortcut must stand down for these, or focusing a button
 * and pressing Enter does nothing.
 */
const ACTIVATABLE_SELECTOR = [
  "a[href]",
  "button",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(", ")

/** True when Enter on this target already means "activate me". */
export function isActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest(ACTIVATABLE_SELECTOR)
}

/**
 * True while a Radix dropdown/context menu is open. An open menu owns the
 * keyboard — it has its own typeahead, arrows and Enter — so a page shortcut
 * firing underneath makes one keystroke do two things.
 */
export function isMenuOpen(): boolean {
  return !!document.querySelector('[role="menu"][data-state="open"]')
}

/**
 * `isMenuOpen` plus dialogs. For surfaces whose overlays are all modal; the
 * board deliberately does NOT use this, because its footer sheets are
 * non-modal dialogs whose own toggle key must stay live (see `modalOpen`).
 */
export function isOverlayOpen(): boolean {
  return (
    isMenuOpen() ||
    !!document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    )
  )
}

// Matched by physical key position (e.Code), so Shift+1/2/3 works on every
// layout — on Swiss/German keyboards Shift+1 yields "+", not "!", so matching
// the printed character (e.key) would silently fail. e.code is layout-agnostic.
const SHIFT_PRIORITY_BY_CODE: Record<string, Operation["priority"]> = {
  Digit1: "low",
  Digit2: "medium",
  Digit3: "high",
}

// US-layout fallback (kept so the shifted symbols still work if e.code is
// ever unavailable, e.g. synthetic events in tests).
const SHIFT_PRIORITY_KEYS: Record<string, Operation["priority"]> = {
  "1": "low",
  "!": "low",
  "2": "medium",
  "@": "medium",
  "3": "high",
  "#": "high",
}

/**
 * Wires every keyboard shortcut on the main kanban page. Each shortcut
 * dispatches into a named callback in `actions` rather than mutating
 * state directly — that makes the hook unit-testable without mounting
 * the entire dashboard.
 *
 * The full key map is rendered by the command palette (Cmd/Ctrl+K or `?`,
 * `components/ui/command-palette.tsx`) — keep its hints in sync.
 */
export function useKanbanShortcuts(
  state: KanbanShortcutsState,
  actions: KanbanShortcutsActions,
): void {
  const {
    modalOpen,
    hoveredOperationId,
    operations,
    vehicleTypes,
    gPrefix,
  } = state

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Esc: cancel g-prefix first, then optionally blur input.
      if (e.key === "Escape") {
        if (gPrefix.cancel()) return
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          ;(e.target as HTMLElement).blur()
          return
        }
      }

      if (isTypingTarget(e.target)) return
      if (modalOpen) return
      // An open menu (UserMenu, a card's context menu) is not covered by
      // `modalOpen` — it is unmanaged Radix state — and it owns the keyboard
      // while it is up.
      if (isMenuOpen()) return

      // g-prefix navigation owns its own state machine.
      if (gPrefix.handleKey(e)) return

      // Open the command palette (? = Shift+/), the single home for shortcuts.
      if (e.key === "?") {
        e.preventDefault()
        openCommandPalette()
        return
      }

      // Zu Fuss on hovered op
      if (e.key === "0" && hoveredOperationId && !e.shiftKey) {
        e.preventDefault()
        actions.onToggleZuFuss(hoveredOperationId)
        return
      }

      // Vehicle quick-assign (1..N)
      const vehicleShortcut = vehicleTypes.find((vt) => vt.key === e.key)
      if (vehicleShortcut && hoveredOperationId) {
        const operation = operations.find((op) => op.id === hoveredOperationId)
        if (operation) {
          const isAssigned = operation.vehicles.includes(vehicleShortcut.name)
          actions.onToggleVehicle(vehicleShortcut, hoveredOperationId, isAssigned)
        }
        return
      }

      // Priority (Shift + 1/2/3) — match physical key first (layout-agnostic),
      // fall back to the printed character for US layout / synthetic events.
      if (e.shiftKey && hoveredOperationId) {
        const priority = SHIFT_PRIORITY_BY_CODE[e.code] ?? SHIFT_PRIORITY_KEYS[e.key]
        if (priority) {
          e.preventDefault()
          actions.onUpdateOperation(hoveredOperationId, { priority })
          return
        }
      }

      // Status forward/backward
      if (e.key === ">" || e.key === ".") {
        e.preventDefault()
        if (hoveredOperationId) actions.onMoveRight(hoveredOperationId)
        return
      }
      if (e.key === "<" || e.key === ",") {
        e.preventDefault()
        if (hoveredOperationId) actions.onMoveLeft(hoveredOperationId)
        return
      }

      // Search
      if (
        e.key === "/" ||
        ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey)
      ) {
        e.preventDefault()
        actions.onFocusSearch()
        return
      }
      if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onFocusPersonnel()
        return
      }
      if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onFocusMaterial()
        return
      }

      // Sheets / modals
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onToggleVehicleFooter()
        return
      }
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onOpenNewEmergency()
        return
      }
      if ((e.key === "a" || e.key === "A") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onToggleAuftraege()
        return
      }
      if ((e.key === "d" || e.key === "D") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onTogglePrint()
        return
      }
      // «Teilen» — the Links & QR sheet, everything the board hands out.
      if ((e.key === "t" || e.key === "T") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onToggleLinks()
        return
      }

      // Sidebars
      if (e.key === "[" || e.key === "q" || e.key === "Q") {
        e.preventDefault()
        actions.onToggleLeftSidebar()
        return
      }
      if (e.key === "]" || e.key === "w" || e.key === "W") {
        e.preventDefault()
        actions.onToggleRightSidebar()
        return
      }
      if (e.key === "\\" || e.key === "i" || e.key === "I") {
        e.preventDefault()
        actions.onToggleSidePanel()
        return
      }
      // `d` used to be «Seitenpanel auf Detail schalten», gated on the panel
      // already being open — and the panel has only had `detail` and `collapsed`
      // since the map mode was dropped, so the guard meant it only ever fired
      // when the mode was already `detail`. A key that could not change anything.
      // It now opens the Drucken-Sheet; the palette entry for the panel stays,
      // where clicking it from a collapsed panel does still do something.
      //
      // `k` carried the same leftover gate: it once switched the panel into a
      // map mode, so it required an open panel. It navigates to /map now, which
      // is nothing to do with the panel — with the panel folded the key did
      // nothing at all, silently, while the palette advertised it. Ungated.
      if ((e.key === "k" || e.key === "K") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onSidePanelMap()
        return
      }
      if ((e.key === "b" || e.key === "B") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onToggleNotifications()
        return
      }

      // Detail modal. `E` is a shortcut like any other; Enter is not — it is
      // the activation key of whatever has focus. Taking it unconditionally
      // killed every focused button and link on the board, because on a dense
      // board the pointer rests over a card nearly all the time. Enter only
      // opens the hovered card when nothing that Enter already means something
      // to has focus.
      if (
        ((e.key === "e" || e.key === "E") && !e.metaKey && !e.ctrlKey) ||
        (e.key === "Enter" && !isActivationTarget(e.target))
      ) {
        if (hoveredOperationId) {
          const operation = operations.find((op) => op.id === hoveredOperationId)
          if (operation) {
            e.preventDefault()
            actions.onOpenDetail(operation)
          }
        }
        return
      }

      // Refresh
      if ((e.key === "r" || e.key === "R" || e.key === "F5") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const toastId = toast.loading(translateOutsideReact("kanban.shortcuts.refreshing"))
        actions
          .onRefresh()
          .then(() => {
            toast.success(translateOutsideReact("kanban.shortcuts.refreshed"), { id: toastId, duration: 1500 })
          })
          .catch(() => {
            toast.error(translateOutsideReact("kanban.shortcuts.refreshFailed"), { id: toastId })
          })
        return
      }

      // Delete with confirmation
      if (e.key === "Delete" || e.key === "Backspace") {
        if (hoveredOperationId) {
          const operation = operations.find((op) => op.id === hoveredOperationId)
          if (operation) {
            e.preventDefault()
            actions.onRequestDelete(operation)
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [
    modalOpen,
    hoveredOperationId,
    operations,
    vehicleTypes,
    gPrefix,
    actions,
  ])
}

"use client"

import { useEffect } from "react"
import { toast } from "sonner"

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
  /** True when the side panel is showing (enables D/K view switch shortcuts). */
  sidePanelOpen: boolean
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
  /** Toggle the personnel (left) sidebar visibility. */
  onToggleLeftSidebar: () => void
  /** Toggle the material (right) sidebar visibility. */
  onToggleRightSidebar: () => void
  /** Toggle the side panel collapsed/detail. */
  onToggleSidePanel: () => void
  /** Switch side panel to Detail view (no-op if collapsed). */
  onSidePanelDetail: () => void
  /** Switch side panel to Map view (no-op if collapsed). */
  onSidePanelMap: () => void
  /** Toggle the notification sidebar. */
  onToggleNotifications: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const role = target.getAttribute("role")
  return role === "combobox" || role === "listbox" || role === "option"
}

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
 * The full key map is rendered by the command palette (Cmd/Ctrl+K,
 * `components/ui/command-palette.tsx`) — keep its hints in sync.
 */
export function useKanbanShortcuts(
  state: KanbanShortcutsState,
  actions: KanbanShortcutsActions,
): void {
  const {
    modalOpen,
    sidePanelOpen,
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

      // g-prefix navigation owns its own state machine.
      if (gPrefix.handleKey(e)) return

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

      // Priority (Shift + 1/2/3) — accepts both digit and shifted symbol
      if (e.shiftKey && hoveredOperationId) {
        const priority = SHIFT_PRIORITY_KEYS[e.key]
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
      if (
        (e.key === "d" || e.key === "D") &&
        !e.metaKey &&
        !e.ctrlKey &&
        sidePanelOpen
      ) {
        e.preventDefault()
        actions.onSidePanelDetail()
        return
      }
      if (
        (e.key === "k" || e.key === "K") &&
        !e.metaKey &&
        !e.ctrlKey &&
        sidePanelOpen
      ) {
        e.preventDefault()
        actions.onSidePanelMap()
        return
      }
      if ((e.key === "b" || e.key === "B") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        actions.onToggleNotifications()
        return
      }

      // Detail modal
      if (
        ((e.key === "e" || e.key === "E") && !e.metaKey && !e.ctrlKey) ||
        e.key === "Enter"
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
        const toastId = toast.loading("Aktualisiere...")
        actions
          .onRefresh()
          .then(() => {
            toast.success("Aktualisiert", { id: toastId, duration: 1500 })
          })
          .catch(() => {
            toast.error("Aktualisierung fehlgeschlagen", { id: toastId })
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
    sidePanelOpen,
    hoveredOperationId,
    operations,
    vehicleTypes,
    gPrefix,
    actions,
  ])
}

'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface CommandPaletteHandlers {
  // Actions
  onNewOperation?: () => void
  onRefresh?: () => void
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
  onToggleVehicleStatus?: () => void
  onToggleAuftraege?: () => void
  /** Open the Aufträge sheet focused on a specific route (from palette search). */
  onOpenAuftrag?: (groupId: string) => void
  onToggleNotifications?: () => void
  // Search actions (open sidebar and focus input)
  onSearchPersonnel?: () => void
  onSearchMaterial?: () => void
  // Side panel
  onToggleSidePanel?: () => void
  onSidePanelDetail?: () => void
  onSidePanelMap?: () => void
  // Incident actions (require a selected incident — items are shown but
  // disabled in the palette when nothing is hovered)
  onEditIncident?: () => void
  onDeleteIncident?: () => void
  onMoveStatusForward?: () => void
  onMoveStatusBackward?: () => void
  onAssignVehicle?: (vehicleNumber: number) => void
  onSetPriority?: (priority: 'low' | 'medium' | 'high') => void
  onToggleZuFuss?: () => void
  // Navigation between incidents
  onSelectPreviousIncident?: () => void
  onSelectNextIncident?: () => void
  // Whether an incident is currently selected
  hasSelectedIncident?: boolean
  // Map view (Lagekarte) actions — only registered on the map page
  onToggleMapLabels?: () => void
  onToggleMapLines?: () => void
  onFocusVehicle?: (vehicleNumber: number) => void
  onMapResetZoom?: () => void
  mapVehicleNames?: string[]
  // Incident search focus (page-specific input; falls back to #search-input)
  onFocusIncidentSearch?: () => void
}

interface CommandPaletteContextValue {
  handlers: CommandPaletteHandlers
  registerHandlers: (handlers: CommandPaletteHandlers) => void
  clearHandlers: () => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [handlers, setHandlers] = useState<CommandPaletteHandlers>({})

  const registerHandlers = useCallback((newHandlers: CommandPaletteHandlers) => {
    setHandlers(newHandlers)
  }, [])

  const clearHandlers = useCallback(() => {
    setHandlers({})
  }, [])

  return (
    <CommandPaletteContext.Provider value={{ handlers, registerHandlers, clearHandlers }}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext)
  if (!context) {
    throw new Error('useCommandPalette must be used within a CommandPaletteProvider')
  }
  return context
}

export function useCommandPaletteHandlers() {
  const context = useContext(CommandPaletteContext)
  return context?.handlers ?? {}
}

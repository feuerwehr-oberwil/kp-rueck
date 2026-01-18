'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface CommandPaletteHandlers {
  // Actions
  onNewOperation?: () => void
  onRefresh?: () => void
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
  onToggleVehicleStatus?: () => void
  onToggleNotifications?: () => void
  // Search actions (open sidebar and focus input)
  onSearchPersonnel?: () => void
  onSearchMaterial?: () => void
  // Incident actions (require a selected incident)
  onEditIncident?: () => void
  onDeleteIncident?: () => void
  onMoveStatusForward?: () => void
  onMoveStatusBackward?: () => void
  onAssignVehicle?: (vehicleNumber: number) => void
  onSetPriority?: (priority: 'low' | 'medium' | 'high') => void
  // Navigation between incidents
  onSelectPreviousIncident?: () => void
  onSelectNextIncident?: () => void
  // Whether an incident is currently selected
  hasSelectedIncident?: boolean
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

"use client"

import { useState, useEffect } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { apiClient, type ApiEventSpecialFunctionResponse, type FunctionType } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { toast } from "sonner"
import { Car, Binoculars, Package2, Check } from 'lucide-react'

interface PersonContextMenuProps {
  children: React.ReactNode
  personnelId: string
  personnelName: string
  currentFunctions: ApiEventSpecialFunctionResponse[]
  onFunctionsChange: () => void
}

export function PersonContextMenu({
  children,
  personnelId,
  personnelName,
  currentFunctions,
  onFunctionsChange,
}: PersonContextMenuProps) {
  const { selectedEvent } = useEvent()
  const [vehicles, setVehicles] = useState<Array<{ id: string; name: string }>>([])
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Load available vehicles and their current drivers
    const loadVehicles = async () => {
      if (!selectedEvent) return

      try {
        const allVehicles = await apiClient.getVehicles()
        // Sort by display_order (1-5)
        const sorted = allVehicles
          .sort((a, b) => a.display_order - b.display_order)
          .map(v => ({ id: v.id, name: v.name }))
        setVehicles(sorted)

        // Load all special functions to see who is assigned as driver
        const allFunctions = await apiClient.getEventSpecialFunctions(selectedEvent.id)
        const driverMap = new Map<string, string>()
        allFunctions
          .filter(f => f.function_type === 'driver' && f.vehicle_id)
          .forEach(f => {
            if (f.vehicle_id) {
              driverMap.set(f.vehicle_id, f.personnel_name)
            }
          })
        setVehicleDrivers(driverMap)
      } catch (error) {
        console.error('Failed to load vehicles:', error)
      }
    }
    loadVehicles()
  }, [selectedEvent])

  const assignFunction = async (functionType: FunctionType, vehicleId?: string) => {
    if (!selectedEvent || loading) return

    setLoading(true)
    try {
      await apiClient.assignSpecialFunction(selectedEvent.id, {
        personnel_id: personnelId,
        function_type: functionType,
        vehicle_id: vehicleId || null,
      })
      toast.success('Funktion zugewiesen', {
        description: `${personnelName} wurde als ${getFunctionLabel(functionType)} zugewiesen`,
      })
      onFunctionsChange()
    } catch (error: any) {
      console.error('Failed to assign function:', error)

      // Handle specific error cases
      const errorDetail = error?.message || error?.response?.data?.detail || ''

      if (errorDetail.includes('already has a driver')) {
        toast.error('Fahrzeug bereits zugewiesen', {
          description: 'Dieses Fahrzeug hat bereits einen Fahrer. Bitte entfernen Sie zuerst den aktuellen Fahrer.',
        })
      } else {
        const errorMessage = errorDetail || 'Funktion konnte nicht zugewiesen werden'
        toast.error('Fehler', { description: errorMessage })
      }
    } finally {
      setLoading(false)
    }
  }

  const unassignFunction = async (functionType: FunctionType, vehicleId?: string) => {
    if (!selectedEvent || loading) return

    setLoading(true)
    try {
      await apiClient.unassignSpecialFunction(selectedEvent.id, {
        personnel_id: personnelId,
        function_type: functionType,
        vehicle_id: vehicleId || null,
      })
      toast.success('Funktion entfernt', {
        description: `${personnelName} wurde als ${getFunctionLabel(functionType)} entfernt`,
      })
      onFunctionsChange()
    } catch (error: any) {
      console.error('Failed to unassign function:', error)
      const errorMessage = error?.response?.data?.detail || 'Funktion konnte nicht entfernt werden'
      toast.error('Fehler', { description: errorMessage })
    } finally {
      setLoading(false)
    }
  }

  const getFunctionLabel = (functionType: FunctionType) => {
    switch (functionType) {
      case 'driver':
        return 'Fahrer'
      case 'reko':
        return 'Reko'
      case 'magazin':
        return 'Magazin'
      default:
        return functionType
    }
  }

  const hasFunction = (functionType: FunctionType, vehicleId?: string) => {
    if (functionType === 'driver') {
      return currentFunctions.some(
        f => f.function_type === functionType && f.vehicle_id === vehicleId
      )
    }
    return currentFunctions.some(f => f.function_type === functionType)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {vehicles.map((vehicle) => {
          const currentDriver = vehicleDrivers.get(vehicle.id)
          const isThisPersonDriver = hasFunction('driver', vehicle.id)

          return (
            <ContextMenuItem
              key={vehicle.id}
              onClick={() => {
                if (isThisPersonDriver) {
                  unassignFunction('driver', vehicle.id)
                } else {
                  assignFunction('driver', vehicle.id)
                }
              }}
              className="flex items-center justify-between"
            >
              <div className="flex items-center">
                {isThisPersonDriver && <Check className="mr-2 h-4 w-4" />}
                <Car className={`mr-2 h-4 w-4 ${!isThisPersonDriver ? 'ml-6' : ''}`} />
                {vehicle.name}
              </div>
              {currentDriver && !isThisPersonDriver && (
                <span className="text-xs text-muted-foreground ml-2">({currentDriver})</span>
              )}
            </ContextMenuItem>
          )
        })}

        {vehicles.length > 0 && <ContextMenuSeparator />}

        <ContextMenuItem
          onClick={() => {
            if (hasFunction('reko')) {
              unassignFunction('reko')
            } else {
              assignFunction('reko')
            }
          }}
        >
          {hasFunction('reko') && <Check className="mr-2 h-4 w-4" />}
          <Binoculars className={`mr-2 h-4 w-4 ${!hasFunction('reko') ? 'ml-6' : ''}`} />
          Reko
        </ContextMenuItem>

        <ContextMenuItem
          onClick={() => {
            if (hasFunction('magazin')) {
              unassignFunction('magazin')
            } else {
              assignFunction('magazin')
            }
          }}
        >
          {hasFunction('magazin') && <Check className="mr-2 h-4 w-4" />}
          <Package2 className={`mr-2 h-4 w-4 ${!hasFunction('magazin') ? 'ml-6' : ''}`} />
          Magazin
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

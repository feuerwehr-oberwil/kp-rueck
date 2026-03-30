"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { type Operation } from "@/lib/contexts/operations-context"
import { apiClient, ApiVehiclePosition } from "@/lib/api-client"
import { useMapMode } from "@/lib/hooks/use-map-mode"

// Priority color mapping
const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444", // red-500
  medium: "#eab308", // yellow-500
  low: "#22c55e", // green-500
}

// Create simple priority-based marker icon
function createOperationIcon(operation: Operation, isSelected: boolean = false): L.DivIcon {
  const priorityColor = PRIORITY_COLORS[operation.priority] || "#6b7280"
  const size = isSelected ? 28 : 20
  const ringSize = size + 10
  const ringOffset = (ringSize - size) / 2

  const selectedRing = isSelected
    ? `<div style="
        position: absolute;
        top: -${ringOffset}px;
        left: -${ringOffset}px;
        width: ${ringSize}px;
        height: ${ringSize}px;
        border: 2px solid #3b82f6;
        border-radius: 50%;
        opacity: 0;
        animation: marker-highlight 1s ease-out forwards;
        pointer-events: none;
      "></div>`
    : ''

  const html = `
    <style>
      @keyframes marker-highlight {
        0% { opacity: 0.8; transform: scale(1.3); }
        100% { opacity: 0; transform: scale(1); }
      }
    </style>
    <div style="position: relative;">
      ${selectedRing}
      <div style="
        width: ${size}px;
        height: ${size}px;
        background-color: ${priorityColor};
        border: ${isSelected ? '3px' : '2px'} solid ${isSelected ? '#3b82f6' : 'white'};
        border-radius: 50%;
        box-shadow: 0 ${isSelected ? 3 : 1}px ${isSelected ? 6 : 3}px oklch(0.18 0.01 60 / ${isSelected ? 0.4 : 0.25});
        transition: all 0.2s ease;
        cursor: pointer;
      "></div>
    </div>
  `

  return L.divIcon({
    html,
    className: "custom-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Create vehicle marker icon — simple blue square with device name
function createVehicleIcon(vehicle: ApiVehiclePosition): L.DivIcon {
  const isOnline = vehicle.status === 'online'
  const size = 22

  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: ${isOnline ? '#3b82f6' : '#6b7280'};
      color: white;
      border: 2px solid white;
      border-radius: 3px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
    ">${vehicle.device_name}</div>
  `

  return L.divIcon({
    html,
    className: "vehicle-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Normalize a vehicle name for matching (lowercase, strip whitespace and punctuation)
function normalizeVehicleName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]+/g, '')
}

// Component to auto-fit bounds
function FitBounds({ operations, vehiclePositions = [] }: { operations: Operation[]; vehiclePositions?: ApiVehiclePosition[] }) {
  const map = useMap()
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (hasInitializedRef.current) return

    const points: [number, number][] = []

    for (const op of operations) {
      if (op.coordinates && op.coordinates[0] && op.coordinates[1]) {
        points.push([op.coordinates[0], op.coordinates[1]])
      }
    }

    for (const vp of vehiclePositions) {
      points.push([vp.latitude, vp.longitude])
    }

    if (points.length === 0) return

    const bounds = L.latLngBounds(points)
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 })
    hasInitializedRef.current = true
  }, [map, operations, vehiclePositions])

  return null
}

// Component to pan to selected operation
function PanToSelected({ selectedOperation }: { selectedOperation: Operation | null }) {
  const map = useMap()

  useEffect(() => {
    if (!selectedOperation || !selectedOperation.coordinates) return

    const [lat, lng] = selectedOperation.coordinates
    if (!lat || !lng) return

    map.flyTo([lat, lng], 15, { duration: 0.5 })
  }, [selectedOperation, map])

  return null
}

interface SidePanelMapContentProps {
  operations: Operation[]
  selectedOperation: Operation | null
  onSelectOperation: (operation: Operation) => void
  onSwitchToDetail?: (operation: Operation) => void
  formatLocation: (address: string) => string
}

export default function SidePanelMapContent({
  operations,
  selectedOperation,
  onSelectOperation,
  onSwitchToDetail,
  formatLocation,
}: SidePanelMapContentProps) {
  const { getTileUrl, getAttribution, handleTileError } = useMapMode()

  // Vehicle positions from Traccar GPS
  const [vehiclePositions, setVehiclePositions] = useState<ApiVehiclePosition[]>([])

  // Fetch vehicle positions from Traccar
  const fetchVehiclePositions = useCallback(async () => {
    try {
      const positions = await apiClient.getVehiclePositions()
      setVehiclePositions(positions)
    } catch {
      // Silent fail - Traccar might not be configured
    }
  }, [])

  // Check Traccar status and start polling if configured
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null

    const checkTraccar = async () => {
      try {
        const status = await apiClient.getTraccarStatus()
        if (status.configured) {
          await fetchVehiclePositions()
          pollInterval = setInterval(fetchVehiclePositions, 10000)
        }
      } catch {
        // Traccar not available
      }
    }

    checkTraccar()

    return () => {
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [fetchVehiclePositions])

  // Vehicle positions for the selected operation's assigned vehicles
  const assignedVehiclePositions = useMemo(() => {
    if (!selectedOperation || vehiclePositions.length === 0) return []

    const assignedNames = selectedOperation.vehicles.map(normalizeVehicleName)

    return vehiclePositions.filter((vp) => {
      const devNorm = normalizeVehicleName(vp.device_name)
      // Exact normalized match, or containment (one name contains the other)
      return assignedNames.some(
        (name) => name === devNorm || name.includes(devNorm) || devNorm.includes(name)
      )
    })
  }, [selectedOperation, vehiclePositions])

  // Filter active operations (not completed) with valid coordinates
  const mappableOperations = useMemo(
    () =>
      operations.filter(
        (op) =>
          op.status !== "complete" &&
          op.coordinates &&
          op.coordinates[0] &&
          op.coordinates[1]
      ),
    [operations]
  )

  // Calculate center point
  const center: LatLngExpression = useMemo(() => {
    if (mappableOperations.length > 0) {
      const avgLat =
        mappableOperations.reduce((sum, op) => sum + (op.coordinates[0] || 0), 0) /
        mappableOperations.length
      const avgLng =
        mappableOperations.reduce((sum, op) => sum + (op.coordinates[1] || 0), 0) /
        mappableOperations.length
      return [avgLat, avgLng]
    }
    // Default to Basel area
    return [47.51637699933488, 7.561800450458299]
  }, [mappableOperations])

  if (mappableOperations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-4">
        <p className="text-center text-sm">Keine Einsätze mit gültigen Koordinaten</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full">
      <MapContainer
        center={center}
        zoom={13}
        className="w-full h-full z-0"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          attribution={getAttribution()}
          url={getTileUrl()}
          eventHandlers={{
            tileerror: handleTileError,
          }}
        />

        {/* Operation Markers */}
        {mappableOperations.map((operation) => {
          const isSelected = selectedOperation?.id === operation.id
          return (
            <Marker
              key={operation.id}
              position={[operation.coordinates[0], operation.coordinates[1]]}
              icon={createOperationIcon(operation, isSelected)}
              eventHandlers={{
                click: () => onSelectOperation(operation),
                dblclick: () => onSwitchToDetail?.(operation),
              }}
            />
          )
        })}

        {/* Vehicle GPS Markers for selected operation */}
        {assignedVehiclePositions.map((vehicle) => (
          <Marker
            key={`vehicle-${vehicle.device_id}`}
            position={[vehicle.latitude, vehicle.longitude]}
            icon={createVehicleIcon(vehicle)}
          >
            <Tooltip permanent={false} direction="top" offset={[0, -11]}>
              <div className="text-xs">
                <div className="font-semibold">{vehicle.device_name}</div>
                {vehicle.speed !== null && vehicle.speed > 1 && (
                  <div className="text-muted-foreground">
                    {Math.round(vehicle.speed)} km/h
                  </div>
                )}
              </div>
            </Tooltip>
          </Marker>
        ))}

        {/* Auto-fit bounds */}
        <FitBounds operations={mappableOperations} vehiclePositions={assignedVehiclePositions} />

        {/* Pan to selected */}
        <PanToSelected selectedOperation={selectedOperation} />
      </MapContainer>

      {/* Mini legend */}
      <div className="absolute bottom-2 left-2 bg-card/90 backdrop-blur-sm rounded-md px-2 py-1.5 text-xs z-10 border border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span>Hoch</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            <span>Mittel</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>Niedrig</span>
          </div>
          {assignedVehiclePositions.length > 0 && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm bg-blue-500" />
              <span>Fahrzeug</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

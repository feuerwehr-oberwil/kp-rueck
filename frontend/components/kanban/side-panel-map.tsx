"use client"

import { useEffect, useMemo, useRef } from "react"
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { type Operation } from "@/lib/contexts/operations-context"
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
  const pulse = isSelected ? 'animation: pulse 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;' : ''

  const html = `
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    </style>
    <div style="
      width: ${size}px;
      height: ${size}px;
      background-color: ${priorityColor};
      border: 2px solid ${isSelected ? '#3b82f6' : 'white'};
      border-radius: 50%;
      box-shadow: 0 ${isSelected ? 3 : 1}px ${isSelected ? 6 : 3}px rgba(0, 0, 0, ${isSelected ? 0.4 : 0.25});
      ${pulse}
      transition: all 0.2s ease;
      cursor: pointer;
    "></div>
  `

  return L.divIcon({
    html,
    className: "custom-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Component to auto-fit bounds
function FitBounds({ operations }: { operations: Operation[] }) {
  const map = useMap()
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (hasInitializedRef.current || operations.length === 0) return

    const validOps = operations.filter(
      (op) => op.coordinates && op.coordinates[0] && op.coordinates[1]
    )

    if (validOps.length === 0) return

    const bounds = L.latLngBounds(
      validOps.map((op) => [op.coordinates[0], op.coordinates[1]] as [number, number])
    )

    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 })
    hasInitializedRef.current = true
  }, [map, operations])

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

        {/* Auto-fit bounds */}
        <FitBounds operations={mappableOperations} />

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
        </div>
      </div>
    </div>
  )
}

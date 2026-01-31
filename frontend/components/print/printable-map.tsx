"use client"

import { useEffect, useState } from "react"
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { Operation } from "@/lib/contexts/operations-context"

// Priority color mapping
const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444", // red-500
  medium: "#eab308", // yellow-500
  low: "#22c55e", // green-500
}

// Create simple colored marker icon
function createMarkerIcon(priority: string): L.DivIcon {
  const color = PRIORITY_COLORS[priority] || "#6b7280"
  const size = 16

  const html = `
    <div style="
      width: ${size}px;
      height: ${size}px;
      background-color: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    "></div>
  `

  return L.divIcon({
    html,
    className: "print-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// Component to auto-fit map bounds to show all operations
function FitBounds({ operations }: { operations: Operation[] }) {
  const map = useMap()

  useEffect(() => {
    if (operations.length === 0) return

    const validOps = operations.filter(
      (op) => op.coordinates && op.coordinates[0] !== 0 && op.coordinates[1] !== 0
    )

    if (validOps.length === 0) return

    const bounds = L.latLngBounds(
      validOps.map((op) => [op.coordinates[0], op.coordinates[1]] as [number, number])
    )

    // Function to fit bounds with proper sizing
    const fitMapBounds = () => {
      map.invalidateSize()
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: false })
    }

    // Try immediately
    fitMapBounds()

    // Also try after a short delay to ensure container is sized
    const timer1 = setTimeout(fitMapBounds, 100)
    const timer2 = setTimeout(fitMapBounds, 300)
    const timer3 = setTimeout(fitMapBounds, 500)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
    }
  }, [map, operations])

  return null
}

interface PrintableMapProps {
  operations: Operation[]
}

export default function PrintableMap({ operations }: PrintableMapProps) {
  const [isReady, setIsReady] = useState(false)

  // Filter operations with valid coordinates
  const mappableOperations = operations.filter(
    (op) => op.coordinates && op.coordinates[0] !== 0 && op.coordinates[1] !== 0
  )

  // Default center (Basel region)
  const defaultCenter: [number, number] = [47.51637699933488, 7.561800450458299]

  // Calculate center from operations if available
  const center: [number, number] = mappableOperations.length > 0
    ? [
        mappableOperations.reduce((sum, op) => sum + op.coordinates[0], 0) / mappableOperations.length,
        mappableOperations.reduce((sum, op) => sum + op.coordinates[1], 0) / mappableOperations.length,
      ]
    : defaultCenter

  useEffect(() => {
    // Small delay to ensure Leaflet CSS is loaded
    const timer = setTimeout(() => setIsReady(true), 100)
    return () => clearTimeout(timer)
  }, [])

  if (mappableOperations.length === 0) {
    return (
      <div className="h-[250px] bg-gray-100 flex items-center justify-center text-gray-500 text-sm border border-gray-300">
        Keine Einsätze mit Koordinaten vorhanden
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="h-[250px] bg-gray-100 flex items-center justify-center text-gray-500 text-sm">
        Karte wird geladen...
      </div>
    )
  }

  return (
    <div className="border border-gray-300 print-map-container" style={{ height: "250px", width: "100%" }}>
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: "250px", width: "100%" }}
        zoomControl={false}
        attributionControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Operation Markers */}
        {mappableOperations.map((operation) => (
          <Marker
            key={operation.id}
            position={[operation.coordinates[0], operation.coordinates[1]]}
            icon={createMarkerIcon(operation.priority)}
          />
        ))}

        {/* Auto-fit bounds */}
        <FitBounds operations={mappableOperations} />
      </MapContainer>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-1 text-[10px]">
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500 border border-white"></span>
          <span>Hoch</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-yellow-500 border border-white"></span>
          <span>Mittel</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full bg-green-500 border border-white"></span>
          <span>Tief</span>
        </div>
      </div>
    </div>
  )
}

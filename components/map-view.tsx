"use client"

import { useEffect } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

interface Operation {
  id: string
  location: string
  vehicle: string | null
  incidentType: string
  priority: "high" | "medium" | "low"
  status: string
  coordinates: [number, number]
  crew: string[]
  materials: string[]
}

interface MapViewProps {
  operations: Operation[]
  onMarkerClick?: (id: string) => void
}

// Get icon based on incident type
function getIncidentIcon(incidentType: string): string {
  if (incidentType.toLowerCase().includes("brand") || incidentType.toLowerCase().includes("feuer")) {
    return "🔥"
  }
  if (incidentType.toLowerCase().includes("technisch")) {
    return "🔧"
  }
  if (incidentType.toLowerCase().includes("alarm")) {
    return "⚠️"
  }
  if (incidentType.toLowerCase().includes("öl")) {
    return "🛢️"
  }
  return "🚨"
}

// Get color based on priority
function getPriorityColor(priority: "high" | "medium" | "low"): string {
  switch (priority) {
    case "high":
      return "#ef4444" // red
    case "medium":
      return "#f97316" // orange
    case "low":
      return "#22c55e" // green
    default:
      return "#6b7280" // gray
  }
}

// Create custom icon for marker
function createCustomIcon(incidentType: string, priority: "high" | "medium" | "low") {
  const color = getPriorityColor(priority)
  const icon = getIncidentIcon(incidentType)

  const html = `
    <div style="position: relative; width: 40px; height: 40px;">
      <div style="
        position: absolute;
        top: 0;
        left: 0;
        width: 40px;
        height: 40px;
        background-color: ${color};
        border: 3px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      "></div>
      <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -60%);
        font-size: 18px;
        z-index: 10;
      ">${icon}</div>
    </div>
  `

  return L.divIcon({
    html,
    className: "custom-marker",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40],
  })
}

// Component to handle map bounds
function MapBounds({ operations }: { operations: Operation[] }) {
  const map = useMap()

  useEffect(() => {
    if (operations.length > 0) {
      const bounds = L.latLngBounds(operations.map((op) => op.coordinates))
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    }
  }, [operations, map])

  return null
}

export default function MapView({ operations, onMarkerClick }: MapViewProps) {
  // Calculate center from operations or use default
  const center: [number, number] =
    operations.length > 0
      ? operations.reduce(
          (acc, op) => [acc[0] + op.coordinates[0], acc[1] + op.coordinates[1]],
          [0, 0]
        ).map((sum) => sum / operations.length) as [number, number]
      : [51.1657, 10.4515]

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden">
      <MapContainer
        center={center}
        zoom={13}
        className="w-full h-full z-0"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {operations.map((op) => (
          <Marker
            key={op.id}
            position={op.coordinates}
            icon={createCustomIcon(op.incidentType, op.priority)}
            eventHandlers={{
              click: () => onMarkerClick?.(op.id),
            }}
          >
            <Popup>
              <div className="space-y-2 min-w-[200px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm">{op.location}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      op.priority === "high"
                        ? "bg-red-500 text-white"
                        : op.priority === "medium"
                        ? "bg-orange-500 text-white"
                        : "bg-green-500 text-white"
                    }`}
                  >
                    {op.priority === "high"
                      ? "Hoch"
                      : op.priority === "medium"
                      ? "Mittel"
                      : "Niedrig"}
                  </span>
                </div>

                <div className="text-sm">
                  <p className="font-medium">{op.incidentType}</p>
                  {op.vehicle && <p className="text-gray-600">Fahrzeug: {op.vehicle}</p>}
                </div>

                {op.crew.length > 0 && (
                  <p className="text-xs text-gray-600">{op.crew.length} Einsatzkräfte</p>
                )}

                {op.materials.length > 0 && (
                  <p className="text-xs text-gray-600">{op.materials.length} Material(ien)</p>
                )}

                <p className="text-xs text-gray-500 capitalize">Status: {op.status}</p>
              </div>
            </Popup>
          </Marker>
        ))}

        <MapBounds operations={operations} />
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 space-y-2 z-[1000] shadow-lg">
        <p className="text-xs font-semibold text-foreground mb-2">Legende</p>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">Priorität:</p>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#ef4444] border border-white shadow-sm" />
            <span className="text-xs text-muted-foreground">Hoch</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#f97316] border border-white shadow-sm" />
            <span className="text-xs text-muted-foreground">Mittel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#22c55e] border border-white shadow-sm" />
            <span className="text-xs text-muted-foreground">Niedrig</span>
          </div>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-border">
          <p className="text-xs font-medium text-foreground">Einsatzart:</p>
          <div className="flex items-center gap-2">
            <span className="text-sm">🔥</span>
            <span className="text-xs text-muted-foreground">Brand</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">🔧</span>
            <span className="text-xs text-muted-foreground">Technische Hilfe</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">⚠️</span>
            <span className="text-xs text-muted-foreground">Fehlalarm</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">🛢️</span>
            <span className="text-xs text-muted-foreground">Ölspur</span>
          </div>
        </div>
      </div>
    </div>
  )
}

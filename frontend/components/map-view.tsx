"use client"

import { useState, useEffect, useMemo } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { useIncidents } from "@/lib/contexts/incidents-context"
import type { Incident } from "@/lib/types/incidents"
import { apiClient } from "@/lib/api-client"
import { MapLegend } from "./map-legend"

// Fix Leaflet default icon issue with Next.js
import icon from "leaflet/dist/images/marker-icon.png"
import iconShadow from "leaflet/dist/images/marker-shadow.png"

const DefaultIcon = L.icon({
  iconUrl: icon.src,
  shadowUrl: iconShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

L.Marker.prototype.options.icon = DefaultIcon

// Status color mapping (matching kanban board colors)
const STATUS_COLORS: Record<string, string> = {
  eingegangen: "#27272a", // zinc-800 (matching kanban "incoming")
  reko: "#166534", // green-800 (matching kanban "ready")
  disponiert: "#1e3a8a", // blue-900 (matching kanban "enroute")
  einsatz: "#7c2d12", // orange-900 (matching kanban "active")
  einsatz_beendet: "#1e40af", // blue-800 (matching kanban "returning")
  abschluss: "#18181b", // zinc-900 (matching kanban "complete")
}

// Incident type to display name mapping
function getIncidentTypeDisplayName(type: string): string {
  const displayNameMap: Record<string, string> = {
    brandbekaempfung: "Brandbekämpfung",
    elementarereignis: "Elementarereignis",
    strassenrettung: "Straßenrettung",
    technische_hilfeleistung: "Technische Hilfeleistung",
    oelwehr: "Ölwehr",
    chemiewehr: "Chemiewehr",
    strahlenwehr: "Strahlenwehr",
    einsatz_bahnanlagen: "Einsatz Bahnanlagen",
    bma_unechte_alarme: "BMA / Unechte Alarme",
    dienstleistungen: "Dienstleistungen",
    diverse_einsaetze: "Diverse Einsätze",
    gerettete_menschen: "Gerettete Menschen",
    gerettete_tiere: "Gerettete Tiere",
  }
  return displayNameMap[type] || type
}

// Priority color mapping
const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444", // red-500
  medium: "#eab308", // yellow-500
  low: "#22c55e", // green-500
}

// Create custom colored icon for incident markers (two-tone: outer ring = status, inner circle = priority)
function createIncidentIcon(incident: Incident): L.DivIcon {
  const statusColor = STATUS_COLORS[incident.status] || "#6b7280"
  const priorityColor = PRIORITY_COLORS[incident.priority] || "#6b7280"

  const html = `
    <div style="
      width: 24px;
      height: 24px;
      background-color: ${statusColor};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      ${incident.training_flag ? 'border-style: dashed;' : ''}
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div style="
        width: 10px;
        height: 10px;
        background-color: ${priorityColor};
        border-radius: 50%;
      "></div>
    </div>
  `

  return L.divIcon({
    html,
    className: "custom-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  })
}

// Component to auto-fit map bounds to show all incidents
function FitBounds({ incidents }: { incidents: Incident[] }) {
  const map = useMap()

  useEffect(() => {
    if (incidents.length === 0) return

    const validIncidents = incidents.filter(
      (inc) => inc.location_lat !== null && inc.location_lng !== null
    )

    if (validIncidents.length === 0) return

    const bounds = L.latLngBounds(
      validIncidents.map((inc) => [inc.location_lat!, inc.location_lng!] as [number, number])
    )

    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
  }, [incidents, map])

  return null
}

// Warning banner for incidents without valid coordinates
function MissingLocationsWarning({ count }: { count: number }) {
  if (count === 0) return null

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-2 rounded shadow-lg z-[1000]">
      ⚠️ {count} Einsatz{count !== 1 ? "e" : ""} ohne gültige Koordinaten
    </div>
  )
}

// Helper function to format time since incident creation
function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

// Helper function to format time
function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Incident popup content
function IncidentPopup({
  incident,
  formatLocation,
  onDetailsClick
}: {
  incident: Incident
  formatLocation: (address: string) => string
  onDetailsClick: (incident: Incident) => void
}) {
  const priorityVariant =
    incident.priority === "high"
      ? "bg-red-100 text-red-800 border-red-300"
      : incident.priority === "medium"
      ? "bg-yellow-100 text-yellow-800 border-yellow-300"
      : "bg-gray-100 text-gray-800 border-gray-300"

  const priorityLabel =
    incident.priority === "high"
      ? "Hoch"
      : incident.priority === "medium"
      ? "Mittel"
      : "Niedrig"

  return (
    <div className="min-w-[280px] max-w-[320px]">
      {/* Title */}
      <div className="mb-3">
        <h3 className="font-bold text-base leading-tight mb-1">{incident.title}</h3>
        {incident.location_address && (
          <p className="text-xs text-gray-600 truncate">
            {formatLocation(incident.location_address)}
          </p>
        )}
      </div>

      {/* Incident type */}
      <div className="mb-2">
        <p className="text-sm font-medium">
          {getIncidentTypeDisplayName(incident.type)}
        </p>
      </div>

      {/* Time information */}
      <div className="flex items-center gap-2 text-xs text-gray-600 mb-3">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="font-mono">
          {formatTime(incident.created_at)} • {getTimeSince(incident.created_at)}
        </span>
      </div>

      {/* Priority and Training badges */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${priorityVariant}`}>
          {priorityLabel}
        </span>
        {incident.training_flag && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
            Übungsmodus
          </span>
        )}
      </div>

      {/* Description preview */}
      {incident.description && (
        <p className="text-xs text-gray-600 line-clamp-2 mb-3">
          {incident.description}
        </p>
      )}

      {/* Assigned vehicles */}
      {incident.assigned_vehicles && incident.assigned_vehicles.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <svg className="h-3.5 w-3.5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
            <span className="text-xs text-gray-600">
              {incident.assigned_vehicles.length} Fahrzeug{incident.assigned_vehicles.length !== 1 ? 'e' : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {incident.assigned_vehicles.slice(0, 3).map((vehicle, idx) => (
              <span key={idx} className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200">
                {vehicle.vehicle_name}
              </span>
            ))}
            {incident.assigned_vehicles.length > 3 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200">
                +{incident.assigned_vehicles.length - 3}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Details button */}
      <button
        className="mt-2 w-full bg-blue-500 text-white px-3 py-2 rounded text-sm font-medium hover:bg-blue-600 transition-colors"
        onClick={() => onDetailsClick(incident)}
      >
        Details anzeigen
      </button>
    </div>
  )
}

interface MapViewProps {
  selectedIncidentId?: string | null
  onMarkerClick?: (incidentId: string) => void
  onDetailsClick?: (incident: Incident) => void
}

export default function MapView({
  selectedIncidentId,
  onMarkerClick,
  onDetailsClick,
}: MapViewProps) {
  const { incidents, formatLocation } = useIncidents()
  const [firestationName, setFirestationName] = useState<string>("Feuerwehr")
  const [firestationCoords, setFirestationCoords] = useState<[number, number]>([
    47.51637699933488, 7.561800450458299,
  ])

  // Load firestation settings from backend
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await apiClient.getAllSettings()
        if (settings.firestation_name) {
          setFirestationName(settings.firestation_name)
        }
        if (settings.firestation_latitude && settings.firestation_longitude) {
          setFirestationCoords([
            parseFloat(settings.firestation_latitude),
            parseFloat(settings.firestation_longitude),
          ])
        }
      } catch (error) {
        console.error("Failed to load firestation settings:", error)
      }
    }

    loadSettings()
  }, [])

  // Filter incidents with valid coordinates and exclude completed incidents
  const mappableIncidents = useMemo(
    () =>
      incidents.filter(
        (inc) => inc.location_lat !== null && inc.location_lng !== null && inc.status !== "abschluss"
      ),
    [incidents]
  )

  // Calculate center point (average of all incidents or firestation)
  const center: LatLngExpression = useMemo(() => {
    if (mappableIncidents.length > 0) {
      const avgLat =
        mappableIncidents.reduce((sum, inc) => sum + (inc.location_lat || 0), 0) /
        mappableIncidents.length
      const avgLng =
        mappableIncidents.reduce((sum, inc) => sum + (inc.location_lng || 0), 0) /
        mappableIncidents.length
      return [avgLat, avgLng]
    }
    return firestationCoords
  }, [mappableIncidents, firestationCoords])

  // Zoom to selected incident
  useEffect(() => {
    if (selectedIncidentId) {
      const incident = mappableIncidents.find((inc) => inc.id === selectedIncidentId)
      if (incident && incident.location_lat && incident.location_lng) {
        // Note: We need access to the map instance here
        // This is handled by the parent component passing the selectedIncidentId
      }
    }
  }, [selectedIncidentId, mappableIncidents])

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

        {/* Incident Markers */}
        {mappableIncidents.map((incident) => (
          <Marker
            key={incident.id}
            position={[incident.location_lat!, incident.location_lng!]}
            icon={createIncidentIcon(incident)}
            eventHandlers={{
              click: () => onMarkerClick?.(incident.id),
            }}
          >
            <Popup>
              <IncidentPopup
                incident={incident}
                formatLocation={formatLocation}
                onDetailsClick={(inc) => onDetailsClick?.(inc)}
              />
            </Popup>
          </Marker>
        ))}

        {/* Auto-fit bounds to show all incidents */}
        <FitBounds incidents={mappableIncidents} />
      </MapContainer>

      {/* Warning for incidents without location */}
      <MissingLocationsWarning
        count={incidents.length - mappableIncidents.length}
      />

      {/* Map Legend */}
      <MapLegend />
    </div>
  )
}

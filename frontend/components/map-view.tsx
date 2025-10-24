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

// Incident popup content
function IncidentPopup({ incident, formatLocation }: { incident: Incident; formatLocation: (address: string) => string }) {
  const priorityColor =
    incident.priority === "critical"
      ? "text-red-600"
      : incident.priority === "high"
      ? "text-orange-600"
      : incident.priority === "medium"
      ? "text-yellow-600"
      : "text-gray-600"

  return (
    <div className="min-w-[200px]">
      <h3 className="font-bold text-lg mb-2">{incident.title}</h3>

      <div className="space-y-1 text-sm">
        <p>
          <strong>Type:</strong> {getIncidentTypeDisplayName(incident.type)}
        </p>
        <p>
          <strong>Priorität:</strong>{" "}
          <span className={`font-bold ${priorityColor}`}>
            {incident.priority === "critical"
              ? "Kritisch"
              : incident.priority === "high"
              ? "Hoch"
              : incident.priority === "medium"
              ? "Mittel"
              : "Niedrig"}
          </span>
        </p>
        <p>
          <strong>Status:</strong> {incident.status}
        </p>
        {incident.location_address && (
          <p>
            <strong>Adresse:</strong> {formatLocation(incident.location_address)}
          </p>
        )}
        {incident.description && (
          <p className="mt-2">
            <strong>Beschreibung:</strong> {incident.description}
          </p>
        )}
        {incident.training_flag && (
          <p className="text-blue-600 font-bold mt-2">Übungsmodus</p>
        )}
      </div>

      <button
        className="mt-3 w-full bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors"
        onClick={() => {
          // Navigate to dashboard with incident highlighted
          window.location.href = `/?incident=${incident.id}`
        }}
      >
        Details anzeigen
      </button>
    </div>
  )
}

interface MapViewProps {
  selectedIncidentId?: string | null
  onMarkerClick?: (incidentId: string) => void
}

export default function MapView({
  selectedIncidentId,
  onMarkerClick,
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
              <IncidentPopup incident={incident} formatLocation={formatLocation} />
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

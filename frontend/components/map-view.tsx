"use client"

import { useState, useEffect, useMemo } from "react"
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { useIncidents } from "@/lib/contexts/operations-context"
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

// Priority color mapping - simplified to single color markers
const PRIORITY_COLORS: Record<string, string> = {
  high: "#ef4444", // red-500
  medium: "#eab308", // yellow-500
  low: "#22c55e", // green-500
}

// Create simple priority-based marker icon with optional highlighting
function createIncidentIcon(incident: Incident, isHighlighted: boolean = false): L.DivIcon {
  const priorityColor = PRIORITY_COLORS[incident.priority] || "#6b7280"
  const size = isHighlighted ? 32 : 24
  const pulse = isHighlighted ? 'animation: pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite;' : ''

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
      border: 3px solid ${isHighlighted ? '#3b82f6' : 'white'};
      border-radius: 50%;
      box-shadow: 0 ${isHighlighted ? 4 : 2}px ${isHighlighted ? 8 : 4}px rgba(0, 0, 0, ${isHighlighted ? 0.5 : 0.3});
      ${pulse}
      transition: all 0.2s ease;
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

// Component to pan/zoom to selected incident
function PanToSelected({ selectedIncidentId, incidents }: { selectedIncidentId: string | null; incidents: Incident[] }) {
  const map = useMap()

  useEffect(() => {
    if (!selectedIncidentId) return

    const incident = incidents.find((inc) => inc.id === selectedIncidentId)
    if (!incident || !incident.location_lat || !incident.location_lng) return

    // Pan and zoom to the selected marker
    map.flyTo([incident.location_lat, incident.location_lng], 16, {
      duration: 0.8,
    })
  }, [selectedIncidentId, incidents, map])

  return null
}

// Component to reset zoom to show all incidents
function ResetZoom({ trigger, incidents }: { trigger: number; incidents: Incident[] }) {
  const map = useMap()

  useEffect(() => {
    if (trigger === 0) return

    if (incidents.length === 0) return

    const validIncidents = incidents.filter(
      (inc) => inc.location_lat !== null && inc.location_lng !== null
    )

    if (validIncidents.length === 0) return

    const bounds = L.latLngBounds(
      validIncidents.map((inc) => [inc.location_lat!, inc.location_lng!] as [number, number])
    )

    map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15, duration: 0.8 })
  }, [trigger, incidents, map])

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


interface MapViewProps {
  selectedIncidentId?: string | null
  onMarkerClick?: (incidentId: string) => void
  onDetailsClick?: (incident: Incident) => void
  resetZoomTrigger?: number // Counter to trigger zoom reset
}

export default function MapView({
  selectedIncidentId,
  onMarkerClick,
  onDetailsClick,
  resetZoomTrigger = 0,
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
        {mappableIncidents.map((incident) => {
          const isHighlighted = selectedIncidentId === incident.id
          return (
            <Marker
              key={incident.id}
              position={[incident.location_lat!, incident.location_lng!]}
              icon={createIncidentIcon(incident, isHighlighted)}
              eventHandlers={{
                click: () => onMarkerClick?.(incident.id),
              }}
            />
          )
        })}

        {/* Auto-fit bounds to show all incidents */}
        <FitBounds incidents={mappableIncidents} />

        {/* Pan to selected incident */}
        <PanToSelected selectedIncidentId={selectedIncidentId ?? null} incidents={mappableIncidents} />

        {/* Reset zoom on trigger */}
        <ResetZoom trigger={resetZoomTrigger} incidents={mappableIncidents} />
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

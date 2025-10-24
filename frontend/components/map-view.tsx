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

// Status color mapping
const STATUS_COLORS: Record<string, string> = {
  eingegangen: "#ef4444", // red
  reko: "#f97316", // orange
  disponiert: "#eab308", // yellow
  einsatz: "#3b82f6", // blue
  einsatz_beendet: "#22c55e", // green
  abschluss: "#6b7280", // gray
}

// Incident type to emoji mapping
function getIncidentTypeEmoji(type: string): string {
  const typeMap: Record<string, string> = {
    brandbekaempfung: "🔥",
    elementarereignis: "🌊",
    strassenrettung: "🚗",
    technische_hilfeleistung: "🔧",
    oelwehr: "🛢️",
    chemiewehr: "☣️",
    strahlenwehr: "☢️",
    einsatz_bahnanlagen: "🚆",
    bma_unechte_alarme: "⚠️",
    dienstleistungen: "🤝",
    diverse_einsaetze: "🚨",
    gerettete_menschen: "👤",
    gerettete_tiere: "🐾",
  }
  return typeMap[type] || "🚨"
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

// Create custom colored icon for incident markers
function createIncidentIcon(incident: Incident): L.DivIcon {
  const color = STATUS_COLORS[incident.status] || "#6b7280"
  const emoji = getIncidentTypeEmoji(incident.type)

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
        ${incident.training_flag ? 'border-style: dashed;' : ''}
      "></div>
      <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -60%);
        font-size: 18px;
        z-index: 10;
      ">${emoji}</div>
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
function IncidentPopup({ incident }: { incident: Incident }) {
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
            <strong>Adresse:</strong> {incident.location_address}
          </p>
        )}
        {incident.description && (
          <p className="mt-2">
            <strong>Beschreibung:</strong> {incident.description}
          </p>
        )}
        {incident.training_flag && (
          <p className="text-blue-600 font-bold mt-2">🎓 Übungsmodus</p>
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
  const { incidents } = useIncidents()
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

  // Filter incidents with valid coordinates
  const mappableIncidents = useMemo(
    () =>
      incidents.filter(
        (inc) => inc.location_lat !== null && inc.location_lng !== null
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

  // Create firestation icon
  const firestationIcon = useMemo(
    () =>
      L.divIcon({
        html: `
      <div style="position: relative; width: 50px; height: 50px;">
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          width: 50px;
          height: 50px;
          background-color: #dc2626;
          border: 4px solid white;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
        "></div>
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -60%);
          font-size: 24px;
          z-index: 10;
        ">🚒</div>
      </div>
    `,
        className: "fire-station-marker",
        iconSize: [50, 50],
        iconAnchor: [25, 50],
        popupAnchor: [0, -50],
      }),
    []
  )

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

        {/* Firestation Marker */}
        <Marker position={firestationCoords} icon={firestationIcon}>
          <Popup>
            <div className="space-y-2 min-w-[200px]">
              <div className="flex items-center gap-2">
                <span className="text-lg">🚒</span>
                <span className="font-bold text-sm">{firestationName}</span>
              </div>
              <p className="text-xs text-gray-600">Hauptstandort</p>
              <p className="text-xs text-gray-500">
                {firestationCoords[0].toFixed(6)}, {firestationCoords[1].toFixed(6)}
              </p>
            </div>
          </Popup>
        </Marker>

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
              <IncidentPopup incident={incident} />
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

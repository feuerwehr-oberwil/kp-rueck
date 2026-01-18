"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { MapContainer, TileLayer, Marker, useMap, Tooltip } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { useIncidents } from "@/lib/contexts/operations-context"
import type { Incident } from "@/lib/types/incidents"
import { apiClient, ApiVehiclePosition } from "@/lib/api-client"
import { MapLegend } from "./map-legend"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import { Wifi, WifiOff, RefreshCw } from "lucide-react"

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
  const pulse = isHighlighted ? 'animation: pulse 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;' : ''

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

// Create vehicle marker icon (truck icon with rotation based on heading)
function createVehicleIcon(vehicle: ApiVehiclePosition): L.DivIcon {
  const isOnline = vehicle.status === 'online'
  const size = 28
  const rotation = vehicle.course ?? 0

  // SVG truck icon pointing up (north)
  const truckSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="${size}" height="${size}">
      <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
    </svg>
  `

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
      border-radius: 6px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      transform: rotate(${rotation}deg);
      transition: all 0.3s ease;
    ">
      ${truckSvg}
    </div>
  `

  return L.divIcon({
    html,
    className: "vehicle-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Component to auto-fit map bounds to show all incidents (only on initial mount)
function FitBounds({ incidents }: { incidents: Incident[] }) {
  const map = useMap()
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    // Only run once on initial mount when we have incidents
    if (hasInitializedRef.current || incidents.length === 0) return

    const validIncidents = incidents.filter(
      (inc) => inc.location_lat !== null && inc.location_lng !== null
    )

    if (validIncidents.length === 0) return

    const bounds = L.latLngBounds(
      validIncidents.map((inc) => [inc.location_lat!, inc.location_lng!] as [number, number])
    )

    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 })
    hasInitializedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]) // Only depend on map, not incidents (run once when map mounts)

  return null
}

// Component to pan/zoom to selected incident
function PanToSelected({ selectedIncidentId, incidents, trigger }: { selectedIncidentId: string | null; incidents: Incident[]; trigger?: number }) {
  const map = useMap()
  const incidentsRef = useRef(incidents)

  // Update ref when incidents change, but don't trigger effect
  useEffect(() => {
    incidentsRef.current = incidents
  }, [incidents])

  useEffect(() => {
    if (!selectedIncidentId) return

    const incident = incidentsRef.current.find((inc) => inc.id === selectedIncidentId)
    if (!incident || !incident.location_lat || !incident.location_lng) return

    // Pan and zoom to the selected marker (always, even if same ID due to trigger)
    map.flyTo([incident.location_lat, incident.location_lng], 16, {
      duration: 0.8,
    })
  }, [selectedIncidentId, map, trigger]) // Only trigger on selection or trigger change, not incidents

  return null
}

// Component to reset zoom to show all incidents and handle map resize
function ResetZoom({ trigger, incidents }: { trigger: number; incidents: Incident[] }) {
  const map = useMap()
  const incidentsRef = useRef(incidents)

  // Update ref when incidents change, but don't trigger effect
  useEffect(() => {
    incidentsRef.current = incidents
  }, [incidents])

  useEffect(() => {
    if (trigger === 0) return

    // Always invalidate size when trigger changes (handles panel resize)
    setTimeout(() => {
      map.invalidateSize()
    }, 100)

    const currentIncidents = incidentsRef.current
    if (currentIncidents.length === 0) return

    const validIncidents = currentIncidents.filter(
      (inc) => inc.location_lat !== null && inc.location_lng !== null
    )

    if (validIncidents.length === 0) return

    const bounds = L.latLngBounds(
      validIncidents.map((inc) => [inc.location_lat!, inc.location_lng!] as [number, number])
    )

    // Delay to ensure size is invalidated first
    setTimeout(() => {
      map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 15, duration: 0.8 })
    }, 200)
  }, [trigger, map]) // Only trigger on explicit trigger change, not incidents

  return null
}

// Warning banner for incidents without valid coordinates
function MissingLocationsWarning({ incidents, onIncidentClick }: { incidents: Incident[]; onIncidentClick?: (incidentId: string) => void }) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (incidents.length === 0) return null

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-warning/15 border border-warning text-warning-foreground px-4 py-2 rounded-lg shadow-md z-30 max-w-md backdrop-blur-sm">
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
        title="Klicken zum Erweitern"
      >
        <span className="font-semibold">
          ⚠️ {incidents.length} Einsatz{incidents.length !== 1 ? "e" : ""} ohne gültige Koordinaten
        </span>
        <span className="text-sm ml-auto">
          {isExpanded ? "▼" : "▶"}
        </span>
      </div>

      {isExpanded && (
        <ul className="mt-3 space-y-1 text-sm border-t border-warning/50 pt-2 max-h-60 overflow-y-auto">
          {incidents.map((incident) => (
            <li
              key={incident.id}
              className="hover:bg-warning/20 px-2 py-1.5 rounded cursor-pointer transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onIncidentClick?.(incident.id)
              }}
              title="Klicken um zu Einsatz zu navigieren"
            >
              <span className="font-medium">• {incident.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Map mode indicator showing online/offline status
function MapModeIndicator({
  preferredMode,
  effectiveMode,
  isAuto,
  onReset,
}: {
  preferredMode: string
  effectiveMode: string
  isAuto: boolean
  onReset: () => void
}) {
  const isOnline = effectiveMode === 'online'
  const showFallbackIndicator = isAuto && !isOnline

  return (
    <div className="absolute top-4 right-4 z-30 flex gap-2">
      {/* Mode indicator */}
      <div
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg shadow-md text-sm font-medium
          ${isOnline
            ? 'bg-success/15 border border-success text-success-foreground'
            : 'bg-warning/15 border border-warning text-warning-foreground'
          }
        `}
        title={`Karten-Modus: ${preferredMode} (${isOnline ? 'Online' : 'Offline'})`}
      >
        {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>

      {/* Retry button (shown when in auto mode and fell back to offline) */}
      {showFallbackIndicator && (
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-3 py-2 rounded-lg shadow-md text-sm font-medium bg-info/15 border border-info text-info-foreground hover:bg-info/25 transition-colors"
          title="Online-Modus erneut versuchen"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Neu versuchen</span>
        </button>
      )}
    </div>
  )
}


interface MapViewProps {
  selectedIncidentId?: string | null
  onMarkerClick?: (incidentId: string) => void
  onDetailsClick?: (incident: Incident) => void
  resetZoomTrigger?: number // Counter to trigger zoom reset
  panTrigger?: number // Counter to trigger pan to selected (for re-clicks)
}

export default function MapView({
  selectedIncidentId,
  onMarkerClick,
  onDetailsClick,
  resetZoomTrigger = 0,
  panTrigger = 0,
}: MapViewProps) {
  const { incidents, formatLocation } = useIncidents()
  const [firestationName, setFirestationName] = useState<string>("Feuerwehr")
  const [firestationCoords, setFirestationCoords] = useState<[number, number]>([
    47.51637699933488, 7.561800450458299,
  ])

  // Vehicle positions from Traccar GPS
  const [vehiclePositions, setVehiclePositions] = useState<ApiVehiclePosition[]>([])
  const [traccarConfigured, setTraccarConfigured] = useState<boolean>(false)

  // Map mode management
  const {
    preferredMode,
    effectiveMode,
    isAuto,
    handleTileError,
    resetEffectiveMode,
    getTileUrl,
    getAttribution,
  } = useMapMode()

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

  // Fetch vehicle positions from Traccar
  const fetchVehiclePositions = useCallback(async () => {
    try {
      const positions = await apiClient.getVehiclePositions()
      setVehiclePositions(positions)
    } catch (error) {
      // Silent fail - Traccar might not be configured
      console.debug("Failed to fetch vehicle positions:", error)
    }
  }, [])

  // Check Traccar status and start polling if configured
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null

    const checkTraccarStatus = async () => {
      try {
        const status = await apiClient.getTraccarStatus()
        setTraccarConfigured(status.configured)

        if (status.configured) {
          // Fetch immediately
          await fetchVehiclePositions()

          // Poll every 10 seconds
          pollInterval = setInterval(fetchVehiclePositions, 10000)
        }
      } catch (error) {
        console.debug("Traccar status check failed:", error)
        setTraccarConfigured(false)
      }
    }

    checkTraccarStatus()

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [fetchVehiclePositions])

  // Filter incidents with valid coordinates and exclude completed incidents
  const mappableIncidents = useMemo(
    () =>
      incidents.filter(
        (inc) => inc.location_lat !== null && inc.location_lng !== null && inc.status !== "abschluss"
      ),
    [incidents]
  )

  // Find incidents without valid coordinates (excluding completed)
  const incidentsWithoutLocation = useMemo(
    () =>
      incidents.filter(
        (inc) => (inc.location_lat === null || inc.location_lng === null) && inc.status !== "abschluss"
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
          attribution={getAttribution()}
          url={getTileUrl()}
          eventHandlers={{
            tileerror: handleTileError,
          }}
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

        {/* Vehicle GPS Markers */}
        {vehiclePositions.map((vehicle) => (
          <Marker
            key={`vehicle-${vehicle.device_id}`}
            position={[vehicle.latitude, vehicle.longitude]}
            icon={createVehicleIcon(vehicle)}
          >
            <Tooltip permanent={false} direction="top" offset={[0, -14]}>
              <div className="text-sm">
                <div className="font-semibold">{vehicle.device_name}</div>
                {vehicle.speed !== null && vehicle.speed > 1 && (
                  <div className="text-xs text-muted-foreground">
                    {Math.round(vehicle.speed)} km/h
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {vehicle.status === 'online' ? 'Online' : 'Offline'}
                </div>
              </div>
            </Tooltip>
          </Marker>
        ))}

        {/* Auto-fit bounds to show all incidents */}
        <FitBounds incidents={mappableIncidents} />

        {/* Pan to selected incident */}
        <PanToSelected selectedIncidentId={selectedIncidentId ?? null} incidents={mappableIncidents} trigger={panTrigger} />

        {/* Reset zoom on trigger */}
        <ResetZoom trigger={resetZoomTrigger} incidents={mappableIncidents} />
      </MapContainer>

      {/* Warning for incidents without location */}
      <MissingLocationsWarning
        incidents={incidentsWithoutLocation}
        onIncidentClick={onMarkerClick}
      />

      {/* Map mode indicator */}
      <MapModeIndicator
        preferredMode={preferredMode}
        effectiveMode={effectiveMode}
        isAuto={isAuto}
        onReset={resetEffectiveMode}
      />

      {/* Map Legend */}
      <MapLegend />
    </div>
  )
}

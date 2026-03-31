"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { MapContainer, TileLayer, Marker, useMap, Tooltip } from "react-leaflet"
import L, { LatLngExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import { useIncidents } from "@/lib/contexts/operations-context"
import type { Incident, IncidentStatus, StatusGroup } from "@/lib/types/incidents"
import { STATUS_TO_GROUP, STATUS_GROUP_BORDER_STYLE } from "@/lib/types/incidents"
import { apiClient, ApiVehiclePosition, ApiVehicle } from "@/lib/api-client"
import { MapLegend } from "./map-legend"
import { AssignmentLines } from "./map/assignment-lines"
import { VehicleTrails } from "./map/vehicle-trails"
import { useMapMode } from "@/lib/hooks/use-map-mode"
import { Wifi, WifiOff, RefreshCw } from "lucide-react"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"

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

// Status border color (dark gray for all statuses)
const STATUS_BORDER_COLOR = "#374151" // gray-700

// Create priority-based marker icon with status-based border styling
function createIncidentIcon(incident: Incident, isHighlighted: boolean = false): L.DivIcon {
  const priorityColor = PRIORITY_COLORS[incident.priority] || "#6b7280"
  const size = isHighlighted ? 32 : 24
  const pulse = isHighlighted ? 'animation: pulse 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;' : ''

  // Get status group styling
  const statusGroup = STATUS_TO_GROUP[incident.status as IncidentStatus] || 'open'
  const borderStyle = STATUS_GROUP_BORDER_STYLE[statusGroup]

  // SVG-based marker with status border ring
  const borderRadius = size / 2
  const innerRadius = borderRadius - 3 // Leave space for border
  const strokeWidth = 2.5
  const borderOffset = strokeWidth / 2

  const html = `
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    </style>
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="${pulse} transition: all 0.2s ease; opacity: ${borderStyle.opacity};">
      <!-- Drop shadow filter -->
      <defs>
        <filter id="shadow-${incident.id}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="${isHighlighted ? 2 : 1}" stdDeviation="${isHighlighted ? 2 : 1}" flood-opacity="${isHighlighted ? 0.4 : 0.25}"/>
        </filter>
      </defs>

      <!-- Priority fill circle with white border -->
      <circle
        cx="${borderRadius}"
        cy="${borderRadius}"
        r="${innerRadius}"
        fill="${priorityColor}"
        stroke="${isHighlighted ? '#3b82f6' : 'white'}"
        stroke-width="3"
        filter="url(#shadow-${incident.id})"
      />

      <!-- Status border ring (outer) -->
      <circle
        cx="${borderRadius}"
        cy="${borderRadius}"
        r="${borderRadius - borderOffset}"
        fill="none"
        stroke="${STATUS_BORDER_COLOR}"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${borderStyle.dasharray}"
      />
    </svg>
  `

  return L.divIcon({
    html,
    className: "custom-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Create vehicle marker icon — simple square with device number
function createVehicleIcon(vehicle: ApiVehiclePosition): L.DivIcon {
  const isOnline = vehicle.status === 'online'
  const size = 28
  const name = vehicle.device_name

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
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
    ">${name}</div>
  `

  return L.divIcon({
    html,
    className: "vehicle-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

// Create firestation marker icon (no label — operators know where they are)
function createFirestationIcon(): L.DivIcon {
  const html = `
    <div style="
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #dc2626;
      color: white;
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      font-size: 14px;
    ">⌂</div>
  `

  return L.divIcon({
    html,
    className: "firestation-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  })
}

// Component that tracks zoom level for conditional label rendering
function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap()

  useEffect(() => {
    onZoomChange(map.getZoom())
    const handler = () => onZoomChange(map.getZoom())
    map.on("zoomend", handler)
    return () => { map.off("zoomend", handler) }
  }, [map, onZoomChange])

  return null
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
  statusFilters?: Record<StatusGroup, boolean> // Status group visibility filters
  showAssignmentLines?: boolean // Show animated lines from vehicles to assigned incidents
  showLabels?: boolean // Show permanent labels on incident markers
}

export default function MapView({
  selectedIncidentId,
  onMarkerClick,
  onDetailsClick,
  resetZoomTrigger = 0,
  panTrigger = 0,
  statusFilters = { open: true, active: true, completed: false },
  showAssignmentLines = true,
  showLabels = true,
}: MapViewProps) {
  const { incidents, formatLocation } = useIncidents()
  const [firestationName, setFirestationName] = useState<string>("Feuerwehr")
  const [firestationCoords, setFirestationCoords] = useState<[number, number]>([
    47.51637699933488, 7.561800450458299,
  ])

  // Vehicle positions from Traccar GPS
  const [vehiclePositions, setVehiclePositions] = useState<ApiVehiclePosition[]>([])
  const [traccarConfigured, setTraccarConfigured] = useState<boolean>(false)
  // KP Rück vehicles for mapping Traccar device names → vehicle names
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([])
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

  // Load firestation settings and vehicle list from backend
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settings, vehicleList] = await Promise.all([
          apiClient.getAllSettings(),
          apiClient.getVehicles().catch(() => [] as ApiVehicle[]),
        ])
        if (settings.firestation_name) {
          setFirestationName(settings.firestation_name)
        }
        if (settings.firestation_latitude && settings.firestation_longitude) {
          setFirestationCoords([
            parseFloat(settings.firestation_latitude),
            parseFloat(settings.firestation_longitude),
          ])
        }
        setVehicles(vehicleList)
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

  // Check Traccar status and use WebSocket + polling fallback for positions
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null
    let unsubscribePositions: (() => void) | null = null
    let unsubscribeStatus: (() => void) | null = null

    const checkTraccarStatus = async () => {
      try {
        const status = await apiClient.getTraccarStatus()
        setTraccarConfigured(status.configured)

        if (status.configured) {
          await fetchVehiclePositions()

          // Listen for WebSocket position updates (server-side Traccar polling)
          unsubscribePositions = wsClient.on('vehicle_positions_update', (data: { data: ApiVehiclePosition[] }) => {
            setVehiclePositions(data.data)
          })

          // Fallback polling when WebSocket is disconnected
          const startPolling = () => {
            if (!pollInterval) {
              pollInterval = setInterval(fetchVehiclePositions, 10000)
            }
          }

          const stopPolling = () => {
            if (pollInterval) {
              clearInterval(pollInterval)
              pollInterval = null
            }
          }

          unsubscribeStatus = wsClient.onStatusChange((wsStatus: WebSocketStatus) => {
            if (wsStatus === 'disconnected' || wsStatus === 'error') {
              startPolling()
            } else if (wsStatus === 'connected') {
              stopPolling()
            }
          })
        }
      } catch (error) {
        console.debug("Traccar status check failed:", error)
        setTraccarConfigured(false)
      }
    }

    checkTraccarStatus()

    return () => {
      if (pollInterval) clearInterval(pollInterval)
      unsubscribePositions?.()
      unsubscribeStatus?.()
    }
  }, [fetchVehiclePositions])

  // Map Traccar device names to KP Rück vehicle names for assignment line matching
  // Strategies: exact name match, then display_order match (numeric device name → vehicle at that order)
  const deviceNameToVehicleName = useMemo(() => {
    if (vehicles.length === 0) return new Map<string, string>()

    const vehicleNames = new Set(vehicles.map(v => v.name.toLowerCase()))
    const orderToName = new Map(vehicles.map(v => [String(v.display_order), v.name]))
    const mapping = new Map<string, string>()

    for (const vp of vehiclePositions) {
      // If the device name already matches a vehicle name, map to itself
      if (vehicleNames.has(vp.device_name.toLowerCase())) {
        mapping.set(vp.device_name, vp.device_name)
        continue
      }
      // Try matching by display_order (e.g., device "1" → vehicle with display_order 1)
      const mappedName = orderToName.get(vp.device_name.trim())
      if (mappedName) {
        mapping.set(vp.device_name, mappedName)
      }
    }

    return mapping
  }, [vehiclePositions, vehicles])

  // Positions with mapped names for assignment line matching
  const mappedVehiclePositions = useMemo(() => {
    if (deviceNameToVehicleName.size === 0) return vehiclePositions
    return vehiclePositions.map(vp => {
      const mapped = deviceNameToVehicleName.get(vp.device_name)
      return mapped && mapped !== vp.device_name ? { ...vp, device_name: mapped } : vp
    })
  }, [vehiclePositions, deviceNameToVehicleName])

  // Filter incidents with valid coordinates and based on status filters
  const mappableIncidents = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.location_lat === null || inc.location_lng === null) return false
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      }),
    [incidents, statusFilters]
  )

  // Find incidents without valid coordinates (based on same status filters)
  const incidentsWithoutLocation = useMemo(
    () =>
      incidents.filter((inc) => {
        if (inc.location_lat !== null && inc.location_lng !== null) return false
        const group = STATUS_TO_GROUP[inc.status as IncidentStatus]
        return group && statusFilters[group]
      }),
    [incidents, statusFilters]
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
          key={getTileUrl()}
          attribution={getAttribution()}
          url={getTileUrl()}
          eventHandlers={{
            tileerror: handleTileError,
          }}
        />

        {/* Firestation marker */}
        <Marker
          position={firestationCoords}
          icon={createFirestationIcon()}
          zIndexOffset={-100}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            <span>{firestationName}</span>
          </Tooltip>
        </Marker>

        {/* Incident Markers */}
        {mappableIncidents.map((incident) => {
          const isHighlighted = selectedIncidentId === incident.id
          const shortAddress = incident.location_address
            ? incident.location_address.split(",")[0].trim()
            : incident.title
          const crewCount = incident.assigned_vehicles.length + (incident.assigned_personnel?.length || 0)
          return (
            <Marker
              key={incident.id}
              position={[incident.location_lat!, incident.location_lng!]}
              icon={createIncidentIcon(incident, isHighlighted)}
              eventHandlers={{
                click: () => onMarkerClick?.(incident.id),
              }}
            >
              {showLabels && (
                <Tooltip
                  direction="right"
                  offset={[14, 0]}
                  permanent={true}
                  className="incident-label"
                >
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>{shortAddress}</span>
                  {crewCount > 0 && (
                    <span style={{ fontSize: '10px', color: '#6b7280', marginLeft: '4px' }}>({crewCount})</span>
                  )}
                </Tooltip>
              )}
            </Marker>
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
                <div className="font-semibold">{deviceNameToVehicleName.get(vehicle.device_name) || vehicle.device_name}</div>
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

        {/* Assignment lines (vehicle GPS → incident) */}
        <AssignmentLines
          incidents={incidents}
          vehiclePositions={mappedVehiclePositions}
          visible={showAssignmentLines}
        />

        {/* Vehicle breadcrumb trails */}
        <VehicleTrails enabled={traccarConfigured} />

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

      {/* Map Legend */}
      <MapLegend />
    </div>
  )
}

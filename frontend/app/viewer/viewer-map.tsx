'use client'

import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMap, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { ApiIncident } from '@/lib/api-client'

// Fix Leaflet default icon issue with Next.js
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

const DefaultIcon = L.icon({
  iconUrl: icon.src,
  shadowUrl: iconShadow.src,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

L.Marker.prototype.options.icon = DefaultIcon

// Priority color mapping
const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444', // red-500
  medium: '#eab308', // yellow-500
  low: '#22c55e', // green-500
}

// Status opacity (completed = faded)
const STATUS_OPACITY: Record<string, number> = {
  eingegangen: 1,
  reko: 1,
  disponiert: 1,
  einsatz: 1,
  einsatz_beendet: 0.7,
  abschluss: 0.4,
}

// Create incident marker icon
function createIncidentIcon(incident: ApiIncident, isHighlighted: boolean = false): L.DivIcon {
  const priorityColor = PRIORITY_COLORS[incident.priority] || '#6b7280'
  const size = isHighlighted ? 32 : 24
  const pulse = isHighlighted ? 'animation: pulse 0.7s cubic-bezier(0.4, 0, 0.6, 1) infinite;' : ''
  const opacity = STATUS_OPACITY[incident.status] || 1

  const borderRadius = size / 2
  const innerRadius = borderRadius - 3

  const html = `
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    </style>
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="${pulse} transition: all 0.2s ease; opacity: ${opacity};">
      <defs>
        <filter id="shadow-viewer-${incident.id}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="${isHighlighted ? 2 : 1}" stdDeviation="${isHighlighted ? 2 : 1}" flood-opacity="${isHighlighted ? 0.4 : 0.25}"/>
        </filter>
      </defs>
      <circle
        cx="${borderRadius}"
        cy="${borderRadius}"
        r="${innerRadius}"
        fill="${priorityColor}"
        stroke="${isHighlighted ? '#3b82f6' : 'white'}"
        stroke-width="3"
        filter="url(#shadow-viewer-${incident.id})"
      />
    </svg>
  `

  return L.divIcon({
    className: 'custom-incident-marker',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

// Format location for tooltip
function formatLocation(address: string | null): string {
  if (!address) return 'Unbekannt'
  const parts = address.split(',')
  return parts[0].trim()
}

// Simple legend marker for the legend panel
function LegendMarker({ fillColor, opacity = 1 }: { fillColor: string; opacity?: number }) {
  const size = 20
  const borderRadius = size / 2
  const innerRadius = borderRadius - 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity }} className="flex-shrink-0">
      <circle
        cx={borderRadius}
        cy={borderRadius}
        r={innerRadius}
        fill={fillColor}
        stroke="white"
        strokeWidth="2"
      />
    </svg>
  )
}

// Simple always-visible legend
function ViewerMapLegend() {
  return (
    <div className="absolute bottom-4 right-4 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg z-30 min-w-[140px]">
      <h3 className="font-semibold text-xs mb-2">Legende</h3>

      {/* Priority Legend */}
      <div className="space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Priorität
        </p>
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <LegendMarker fillColor="#ef4444" />
            <span className="text-[11px]">Hoch</span>
          </div>
          <div className="flex items-center gap-1.5">
            <LegendMarker fillColor="#eab308" />
            <span className="text-[11px]">Mittel</span>
          </div>
          <div className="flex items-center gap-1.5">
            <LegendMarker fillColor="#22c55e" />
            <span className="text-[11px]">Niedrig</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Component to handle map center/zoom changes
function MapController({
  incidents,
  selectedIncidentId,
}: {
  incidents: ApiIncident[]
  selectedIncidentId: string | null
}) {
  const map = useMap()
  const hasInitializedRef = useRef(false)

  // Fit bounds to all incidents on initial load
  useEffect(() => {
    if (hasInitializedRef.current) return

    const validIncidents = incidents.filter(
      (inc) => inc.location_lat && inc.location_lng
    )

    if (validIncidents.length > 0) {
      const bounds = L.latLngBounds(
        validIncidents.map((inc) => [
          parseFloat(inc.location_lat!),
          parseFloat(inc.location_lng!),
        ])
      )
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
      hasInitializedRef.current = true
    }
  }, [incidents, map])

  // Pan to selected incident
  useEffect(() => {
    if (!selectedIncidentId) return

    const incident = incidents.find((inc) => inc.id === selectedIncidentId)
    if (incident?.location_lat && incident?.location_lng) {
      map.setView(
        [parseFloat(incident.location_lat), parseFloat(incident.location_lng)],
        Math.max(map.getZoom(), 14),
        { animate: true }
      )
    }
  }, [selectedIncidentId, incidents, map])

  return null
}

interface ViewerMapViewProps {
  incidents: ApiIncident[]
  selectedIncidentId: string | null
  onMarkerClick: (id: string) => void
}

export default function ViewerMapView({
  incidents,
  selectedIncidentId,
  onMarkerClick,
}: ViewerMapViewProps) {
  // Default center (Basel area)
  const defaultCenter: [number, number] = [47.51637699933488, 7.561800450458299]
  const defaultZoom = 13

  // Filter incidents with valid coordinates
  const validIncidents = useMemo(() => {
    return incidents.filter(
      (inc) => inc.location_lat && inc.location_lng
    )
  }, [incidents])

  return (
    <div className="w-full h-full rounded-lg overflow-hidden border border-border relative">
      <ViewerMapLegend />
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        className="w-full h-full"
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapController
          incidents={incidents}
          selectedIncidentId={selectedIncidentId}
        />

        {validIncidents.map((incident) => {
          const isHighlighted = incident.id === selectedIncidentId
          const position: [number, number] = [
            parseFloat(incident.location_lat!),
            parseFloat(incident.location_lng!),
          ]

          return (
            <Marker
              key={incident.id}
              position={position}
              icon={createIncidentIcon(incident, isHighlighted)}
              eventHandlers={{
                click: () => onMarkerClick(incident.id),
              }}
              zIndexOffset={isHighlighted ? 1000 : 0}
            >
              <Tooltip
                direction="top"
                offset={[0, -12]}
                opacity={0.95}
              >
                <div className="text-sm font-medium">
                  {formatLocation(incident.location_address || incident.title)}
                </div>
                {incident.description && (
                  <div className="text-xs text-gray-500 max-w-[200px] truncate">
                    {incident.description}
                  </div>
                )}
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}

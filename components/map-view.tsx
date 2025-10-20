"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"

interface Operation {
  id: string
  vehicle: string
  location: string
  incidentType: string
  priority: "high" | "medium" | "low"
  status: string
  coordinates: [number, number]
}

interface MapViewProps {
  operations: Operation[]
}

export default function MapView({ operations }: MapViewProps) {
  const [hoveredOp, setHoveredOp] = useState<string | null>(null)

  const latRange = [51.15, 51.19]
  const lngRange = [10.44, 10.48]

  const coordsToSVG = (coords: [number, number]): [number, number] => {
    const [lat, lng] = coords
    const x = ((lng - lngRange[0]) / (lngRange[1] - lngRange[0])) * 100
    const y = ((latRange[1] - lat) / (latRange[1] - latRange[0])) * 100
    return [x, y]
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "#ef4444"
      case "medium":
        return "#f97316"
      case "low":
        return "#22c55e"
      default:
        return "#6b7280"
    }
  }

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case "high":
        return "Hoch"
      case "medium":
        return "Mittel"
      case "low":
        return "Niedrig"
      default:
        return priority
    }
  }

  return (
    <div className="relative w-full h-full bg-zinc-900 rounded-lg overflow-hidden">
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid background */}
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#grid)" />

        {/* Street lines for visual context */}
        <line x1="20" y1="0" x2="20" y2="100" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
        <line x1="80" y1="0" x2="80" y2="100" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
        <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />
        <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.1)" strokeWidth="0.3" />

        {/* Operation markers */}
        {operations.map((op) => {
          const [x, y] = coordsToSVG(op.coordinates)
          const color = getPriorityColor(op.priority)
          const isHovered = hoveredOp === op.id

          return (
            <g
              key={op.id}
              onMouseEnter={() => setHoveredOp(op.id)}
              onMouseLeave={() => setHoveredOp(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Pulse animation for active markers */}
              {isHovered && (
                <circle cx={x} cy={y} r="4" fill={color} opacity="0.3">
                  <animate attributeName="r" from="4" to="8" dur="1s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.3" to="0" dur="1s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Marker circle */}
              <circle
                cx={x}
                cy={y}
                r={isHovered ? "3" : "2.5"}
                fill={color}
                stroke="white"
                strokeWidth="0.5"
                style={{ transition: "all 0.2s" }}
              />

              {/* Vehicle icon (simplified fire truck emoji representation) */}
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="3"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                🚒
              </text>
            </g>
          )
        })}
      </svg>

      {/* Tooltip overlay */}
      {hoveredOp && (
        <div className="absolute top-4 left-4 right-4 bg-card border border-border rounded-lg p-3 shadow-xl z-10 pointer-events-none">
          {operations
            .filter((op) => op.id === hoveredOp)
            .map((op) => (
              <div key={op.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground">{op.vehicle}</span>
                  <Badge
                    variant={
                      op.priority === "high" ? "destructive" : op.priority === "medium" ? "default" : "secondary"
                    }
                    className="text-xs"
                  >
                    {getPriorityLabel(op.priority)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{op.location}</p>
                <p className="text-sm text-foreground">{op.incidentType}</p>
              </div>
            ))}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm border border-border rounded-lg p-3 space-y-2">
        <p className="text-xs font-semibold text-foreground mb-2">Priorität</p>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#ef4444] border border-white" />
          <span className="text-xs text-muted-foreground">Hoch</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#f97316] border border-white" />
          <span className="text-xs text-muted-foreground">Mittel</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#22c55e] border border-white" />
          <span className="text-xs text-muted-foreground">Niedrig</span>
        </div>
      </div>
    </div>
  )
}

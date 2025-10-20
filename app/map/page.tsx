"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ArrowLeft, MapPin, Clock, Users, Package } from "lucide-react"
import { useOperations } from "@/lib/contexts/operations-context"

// Dynamically import map to avoid SSR issues with Leaflet
const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-lg">
      <div className="text-muted-foreground">Karte wird geladen...</div>
    </div>
  ),
})

function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

export default function MapPage() {
  const { operations } = useOperations()
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null)

  const selectedOperation = useMemo(
    () => operations.find((op) => op.id === selectedOpId),
    [operations, selectedOpId]
  )

  const activeOperations = useMemo(
    () => operations.filter((op) => op.status !== "complete"),
    [operations]
  )

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-lg">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-2xl shadow-lg">
            🚒
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Lagekarte</h1>
        </div>

        <Link href="/">
          <Button variant="outline" className="gap-2">
            <MapPin className="h-4 w-4" />
            Zur Übersicht
          </Button>
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <main className="flex-1 p-4">
          <MapView operations={activeOperations} onMarkerClick={setSelectedOpId} />
        </main>

        {/* Sidebar */}
        <aside className="w-96 border-l border-border/50 bg-card/30 backdrop-blur-sm overflow-y-auto">
          <div className="p-4">
            <h2 className="text-lg font-bold mb-4">
              Aktive Einsätze ({activeOperations.length})
            </h2>

            <div className="space-y-3">
              {activeOperations.map((op) => (
                <Card
                  key={op.id}
                  className={`p-4 cursor-pointer transition-all hover:border-primary/50 ${
                    selectedOpId === op.id ? "border-primary ring-2 ring-primary/20" : ""
                  }`}
                  onClick={() => setSelectedOpId(op.id)}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <MapPin className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm leading-tight">{op.location}</h3>
                          {op.vehicle && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {op.vehicle}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge
                        variant={
                          op.priority === "high"
                            ? "destructive"
                            : op.priority === "medium"
                            ? "default"
                            : "secondary"
                        }
                        className="text-xs flex-shrink-0"
                      >
                        {op.priority === "high"
                          ? "Hoch"
                          : op.priority === "medium"
                          ? "Mittel"
                          : "Niedrig"}
                      </Badge>
                    </div>

                    <p className="text-sm font-medium">{op.incidentType}</p>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{getTimeSince(op.dispatchTime)}</span>
                    </div>

                    {op.crew.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        <span>{op.crew.length} Einsatzkräfte</span>
                      </div>
                    )}

                    {op.materials.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Package className="h-3 w-3" />
                        <span>{op.materials.length} Material(ien)</span>
                      </div>
                    )}

                    <Badge variant="outline" className="text-xs capitalize">
                      {op.status === "incoming"
                        ? "Eingegangen"
                        : op.status === "ready"
                        ? "Bereit"
                        : op.status === "enroute"
                        ? "Unterwegs"
                        : op.status === "active"
                        ? "Aktiv"
                        : op.status === "returning"
                        ? "Rückkehr"
                        : "Abgeschlossen"}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ArrowLeft, MapPin, Clock, FileText } from "lucide-react"
import { useIncidents } from "@/lib/contexts/incidents-context"
import { ProtectedRoute } from "@/components/protected-route"
import { UserMenu } from "@/components/user-menu"

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

function getIncidentTypeDisplayName(type: string): string {
  const displayNameMap: Record<string, string> = {
    brandbekaempfung: "Brandbekämpfung",
    elementarereignis: "Elementarereignis",
    strassenrettung: "Strassenrettung",
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

function getStatusDisplayName(status: string): string {
  const statusMap: Record<string, string> = {
    eingegangen: "Eingegangen",
    reko: "Reko",
    disponiert: "Disponiert",
    einsatz: "Einsatz",
    einsatz_beendet: "Einsatz Beendet",
    abschluss: "Abschluss",
  }
  return statusMap[status] || status
}

export default function MapPage() {
  const { incidents, formatLocation, refreshIncidents } = useIncidents()
  const searchParams = useSearchParams()
  const highlightParam = searchParams.get("highlight")
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    highlightParam
  )

  const selectedIncident = useMemo(
    () => incidents.find((inc) => inc.id === selectedIncidentId),
    [incidents, selectedIncidentId]
  )

  // Filter out completed incidents for the active list
  const activeIncidents = useMemo(
    () => incidents.filter((inc) => inc.status !== "abschluss"),
    [incidents]
  )

  // Refresh incidents immediately when map page loads
  useEffect(() => {
    refreshIncidents()
  }, [])

  useEffect(() => {
    if (highlightParam) {
      setSelectedIncidentId(highlightParam)
    }
  }, [highlightParam])

  return (
    <ProtectedRoute>
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
            <Badge variant="secondary" className="ml-2">
              {activeIncidents.length} Aktiv
            </Badge>
          </div>

          <div className="flex items-center gap-4">
            <UserMenu />

            <Link href="/">
              <Button variant="outline" className="gap-2">
                <MapPin className="h-4 w-4" />
                Zum Kanban
              </Button>
            </Link>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Map */}
          <main className="flex-1 p-4">
            <MapView
              selectedIncidentId={selectedIncidentId}
              onMarkerClick={setSelectedIncidentId}
            />
          </main>

          {/* Sidebar */}
          <aside className="w-96 border-l border-border/50 bg-card/30 backdrop-blur-sm overflow-y-auto">
            <div className="p-4">
              <h2 className="text-lg font-bold mb-4">
                Aktive Einsätze ({activeIncidents.length})
              </h2>

              <div className="space-y-3">
                {activeIncidents.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Keine aktiven Einsätze
                  </p>
                ) : (
                  activeIncidents.map((incident) => (
                    <Card
                      key={incident.id}
                      className={`p-4 cursor-pointer transition-all hover:border-primary/50 ${
                        selectedIncidentId === incident.id
                          ? "border-primary ring-2 ring-primary/20"
                          : ""
                      }`}
                      onClick={() => setSelectedIncidentId(incident.id)}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <MapPin className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
                            <div className="min-w-0">
                              <h3 className="font-bold text-sm leading-tight">
                                {incident.location_address ? formatLocation(incident.location_address) : incident.title}
                              </h3>
                              {incident.type && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                  {getIncidentTypeDisplayName(incident.type)}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <Link
                              href={`/?incident=${incident.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="p-1.5 rounded-md hover:bg-primary/20 transition-colors"
                              title="Im Kanban anzeigen"
                            >
                              <FileText className="h-4 w-4 text-primary" />
                            </Link>
                            <Badge
                              variant={
                                incident.priority === "critical"
                                  ? "destructive"
                                  : incident.priority === "high"
                                  ? "destructive"
                                  : incident.priority === "medium"
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-xs"
                            >
                              {incident.priority === "critical"
                                ? "Kritisch"
                                : incident.priority === "high"
                                ? "Hoch"
                                : incident.priority === "medium"
                                ? "Mittel"
                                : "Niedrig"}
                            </Badge>
                          </div>
                        </div>

                        <p className="text-sm font-medium">
                          {getIncidentTypeDisplayName(incident.type)}
                        </p>

                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{getTimeSince(incident.created_at)}</span>
                        </div>

                        {incident.training_flag && (
                          <Badge variant="outline" className="text-xs">
                            🎓 Übungsmodus
                          </Badge>
                        )}

                        <Badge variant="outline" className="text-xs capitalize">
                          {getStatusDisplayName(incident.status)}
                        </Badge>

                        {incident.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
                            {incident.description}
                          </p>
                        )}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </ProtectedRoute>
  )
}

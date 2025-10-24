"use client"

import { useState, useMemo, useEffect } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ArrowLeft, FileText } from "lucide-react"
import { useIncidents } from "@/lib/contexts/incidents-context"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { IncidentForm } from "@/components/incidents/incident-form"
import type { Incident } from "@/lib/types/incidents"

// Dynamically import map to avoid SSR issues with Leaflet
const MapView = dynamic(() => import("@/components/map-view"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-zinc-900 rounded-lg">
      <div className="text-muted-foreground">Karte wird geladen...</div>
    </div>
  ),
})

function getStatusDisplayName(status: string): string {
  const statusMap: Record<string, string> = {
    eingegangen: "Eingegangen",
    reko: "Reko",
    disponiert: "Disponiert",
    einsatz: "Einsatz",
    einsatz_beendet: "Beendet",
    abschluss: "Abschluss",
  }
  return statusMap[status] || status
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function MapPage() {
  const { incidents, formatLocation, refreshIncidents } = useIncidents()
  const searchParams = useSearchParams()
  const highlightParam = searchParams.get("highlight")
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    highlightParam
  )
  const [incidentForModal, setIncidentForModal] = useState<Incident | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const selectedIncident = useMemo(
    () => incidents.find((inc) => inc.id === selectedIncidentId),
    [incidents, selectedIncidentId]
  )

  const handleDetailsClick = (incident: Incident) => {
    setIncidentForModal(incident)
    setFormOpen(true)
  }

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
            <PageNavigation currentPage="map" />
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Map */}
          <main className="flex-1 p-4">
            <MapView
              selectedIncidentId={selectedIncidentId}
              onMarkerClick={setSelectedIncidentId}
              onDetailsClick={handleDetailsClick}
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
                      className={`p-3 cursor-pointer transition-all hover:border-primary/50 ${
                        selectedIncidentId === incident.id
                          ? "border-primary ring-2 ring-primary/20"
                          : ""
                      }`}
                      onClick={() => setSelectedIncidentId(incident.id)}
                    >
                      <div className="space-y-2">
                        {/* Location and Details button */}
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-sm leading-tight flex-1">
                            {incident.location_address ? formatLocation(incident.location_address) : incident.title}
                          </h3>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDetailsClick(incident)
                            }}
                            className="p-1 rounded-md hover:bg-primary/20 transition-colors flex-shrink-0"
                            title="Details anzeigen"
                          >
                            <FileText className="h-4 w-4 text-primary" />
                          </button>
                        </div>

                        {/* Priority, Time, and Status */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant={
                              incident.priority === "high"
                                ? "destructive"
                                : incident.priority === "medium"
                                ? "default"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {incident.priority === "high"
                              ? "Hoch"
                              : incident.priority === "medium"
                              ? "Mittel"
                              : "Niedrig"}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {formatTime(incident.created_at)}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {getStatusDisplayName(incident.status)}
                          </Badge>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>

        {/* Incident Form Modal */}
        <IncidentForm
          open={formOpen}
          onOpenChange={setFormOpen}
          incident={incidentForModal}
          mode="edit"
        />
      </div>
    </ProtectedRoute>
  )
}

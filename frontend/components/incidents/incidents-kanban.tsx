"use client"

import { useState, useEffect } from "react"
import { IncidentCard } from "./incident-card"
import { IncidentForm } from "./incident-form"
import { TransferIncidentDialog } from "./transfer-incident-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, RefreshCw } from 'lucide-react'
import { useIncidents } from "@/lib/contexts/operations-context"
import type { Incident } from "@/lib/types/incidents"
import { KANBAN_COLUMNS } from "@/lib/types/incidents"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"

export function IncidentsKanban() {
  const { incidents, isLoading, error, refreshIncidents, trainingMode, setTrainingMode } = useIncidents()
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [isMounted, setIsMounted] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferSourceIncident, setTransferSourceIncident] = useState<Incident | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const handleCreateClick = () => {
    setSelectedIncident(null)
    setFormMode('create')
    setFormOpen(true)
  }

  const handleEditClick = (incident: Incident) => {
    setSelectedIncident(incident)
    setFormMode('edit')
    setFormOpen(true)
  }

  const handleTransferClick = (incident: Incident) => {
    setTransferSourceIncident(incident)
    setTransferDialogOpen(true)
  }

  const handleTransfer = async (targetIncidentId: string) => {
    if (!transferSourceIncident) return

    try {
      setIsTransferring(true)
      await apiClient.transferAssignments(transferSourceIncident.id, targetIncidentId)
      toast.success("Ressourcen übertragen", {
        description: `Alle Ressourcen wurden erfolgreich übertragen.`
      })
      setTransferDialogOpen(false)
      refreshIncidents()
    } catch (error: any) {
      toast.error("Fehler beim Übertragen", {
        description: error?.message || "Die Ressourcen konnten nicht übertragen werden."
      })
    } finally {
      setIsTransferring(false)
    }
  }

  if (!isMounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-2xl shadow-lg">
            🚒
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Einsatzübersicht (Incidents)</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Training mode toggle */}
          <div className="flex items-center gap-2">
            <Button
              variant={trainingMode ? "default" : "outline"}
              size="sm"
              onClick={() => setTrainingMode(!trainingMode)}
              className={trainingMode ? "bg-amber-500 hover:bg-amber-600" : ""}
            >
              {trainingMode ? "Übungsmodus" : "Live-Modus"}
            </Button>
          </div>

          {/* Refresh button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshIncidents()}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </Button>

          {/* Create button */}
          <Button onClick={handleCreateClick} size="sm" variant="secondary" className="gap-2">
            <Plus className="h-4 w-4" />
            Neuer Einsatz
          </Button>
        </div>
      </header>

      {/* Error message */}
      {error && (
        <div className="bg-destructive/10 text-destructive px-6 py-3 border-b border-destructive/20">
          <p className="text-sm font-medium">Fehler: {error}</p>
        </div>
      )}

      {/* Kanban Board */}
      <main className="flex-1 overflow-x-auto p-4 bg-zinc-950/20">
        <div className="flex h-full gap-4">
          {KANBAN_COLUMNS.map((column) => {
            const columnIncidents = incidents.filter((inc) =>
              column.status.includes(inc.status)
            )

            return (
              <div key={column.id} className="flex w-64 flex-shrink-0 flex-col">
                {/* Column header */}
                <div
                  className={`mb-3 rounded-lg ${column.color} border border-border/50 px-4 py-3 transition-all`}
                >
                  <h2 className="text-balance text-sm font-bold uppercase tracking-wide text-foreground">
                    {column.title}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {columnIncidents.length} Einsätze
                  </p>
                </div>

                {/* Column content */}
                <div className="flex-1 space-y-3 overflow-y-auto p-2 rounded-lg min-h-[200px]">
                  {columnIncidents.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                      Keine Einsätze
                    </div>
                  ) : (
                    columnIncidents.map((incident) => (
                      <IncidentCard
                        key={incident.id}
                        incident={incident}
                        columnColor={column.color}
                        onEdit={() => handleEditClick(incident)}
                        onUpdate={refreshIncidents}
                        onTransfer={() => handleTransferClick(incident)}
                        isDraggable={false} // Disable dragging for now (can be enabled with drag-and-drop implementation)
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* Footer stats */}
      <footer className="border-t border-border/50 bg-card/50 backdrop-blur-sm px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Gesamt: <span className="font-medium text-foreground">{incidents.length}</span> Einsätze
            {trainingMode && (
              <Badge variant="outline" className="ml-2 bg-amber-500/10 text-amber-500 border-amber-500/20">
                Nur Übungen
              </Badge>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            Zum Bearbeiten auf Einsatzkarte klicken
          </div>
        </div>
      </footer>

      {/* Incident Form Modal */}
      <IncidentForm
        open={formOpen}
        onOpenChange={setFormOpen}
        incident={selectedIncident}
        mode={formMode}
      />

      {/* Transfer Incident Dialog */}
      {transferSourceIncident && (
        <TransferIncidentDialog
          open={transferDialogOpen}
          onOpenChange={setTransferDialogOpen}
          sourceIncident={transferSourceIncident}
          availableIncidents={incidents}
          onTransfer={handleTransfer}
          isTransferring={isTransferring}
        />
      )}
    </div>
  )
}

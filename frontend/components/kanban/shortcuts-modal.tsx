"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"

interface ShortcutsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicleTypes: Array<{ key: string; name: string }>
}

export function ShortcutsModal({ open, onOpenChange, vehicleTypes }: ShortcutsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Schnellreferenz</DialogTitle>
          <DialogDescription>
            Die wichtigsten Tastaturkürzel
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Pointer to Cmd+K */}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Kbd className="bg-blue-500/20">⌘K</Kbd>
              <span className="text-sm font-semibold">Alle Befehle & Tastaturkürzel</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Drücke Cmd+K (Mac) oder Ctrl+K (Windows) für die vollständige Liste
            </p>
          </div>

          {/* Essential shortcuts */}
          <div>
            <h3 className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Häufig verwendet</h3>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                <span className="text-sm">Suchen</span>
                <Kbd className="h-5 text-xs">/</Kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                <span className="text-sm">Neuer Einsatz</span>
                <Kbd className="h-5 text-xs">N</Kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                <span className="text-sm">Bearbeiten</span>
                <Kbd className="h-5 text-xs">E</Kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                <span className="text-sm">Navigation (Kanban → Map → Events)</span>
                <Kbd className="h-5 text-xs">G dann K/M/E</Kbd>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                <span className="text-sm">Aktualisieren</span>
                <Kbd className="h-5 text-xs">R</Kbd>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

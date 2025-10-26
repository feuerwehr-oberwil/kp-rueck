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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Tastaturkürzel</DialogTitle>
          <DialogDescription>Schnelle Navigation und Fahrzeugzuweisung</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div>
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Fahrzeugzuweisung</h3>
            <div className="space-y-2">
              {vehicleTypes.map((vt) => (
                <div key={vt.key} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                  <span className="text-sm font-medium">{vt.name}</span>
                  <Kbd>{vt.key}</Kbd>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Prioritäts-Zuweisung (im Einsatzformular)</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Niedrig</span>
                <Kbd>Shift+1</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Mittel</span>
                <Kbd>Shift+2</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Hoch</span>
                <Kbd>Shift+3</Kbd>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Navigation</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Karte nach rechts bewegen</span>
                <Kbd>&gt;</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Karte nach links bewegen</span>
                <Kbd>&lt;</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Suche fokussieren</span>
                <Kbd>/</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Suche verlassen</span>
                <Kbd>Esc</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Neuer Einsatz</span>
                <Kbd>N</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Diese Hilfe anzeigen</span>
                <Kbd>?</Kbd>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Seitenleisten</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Personen-Seitenleiste ein/ausblenden</span>
                <Kbd>[</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Material-Seitenleiste ein/ausblenden</span>
                <Kbd>]</Kbd>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Map, Zap, Edit, ArrowUpDown, Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface ShortcutsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicleTypes: Array<{ key: string; name: string }>
}

interface ShortcutCategory {
  title: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  shortcuts: Array<{
    keys: string[]
    description: string
  }>
}

export function ShortcutsModal({ open, onOpenChange, vehicleTypes }: ShortcutsModalProps) {
  const shortcutCategories: ShortcutCategory[] = [
    {
      title: 'Navigation',
      icon: Map,
      shortcuts: [
        { keys: ['G', 'K'], description: 'Kanban Board' },
        { keys: ['G', 'M'], description: 'Lagekarte' },
        { keys: ['G', 'E'], description: 'Ereignisse' },
      ],
    },
    {
      title: 'Aktionen',
      icon: Zap,
      shortcuts: [
        { keys: ['N'], description: 'Neuer Einsatz' },
        { keys: ['/'], description: 'Suche fokussieren' },
        { keys: ['⌘', 'K'], description: 'Befehlspalette' },
        { keys: ['R'], description: 'Aktualisieren' },
        { keys: ['?'], description: 'Diese Hilfe' },
      ],
    },
    {
      title: 'Einsatz bearbeiten',
      icon: Edit,
      description: 'Einsatz mit Maus auswählen, dann:',
      shortcuts: [
        { keys: ['E'], description: 'Details öffnen' },
        { keys: ['Enter'], description: 'Details öffnen' },
        { keys: ['1', '2', '3', '4', '5'], description: 'Fahrzeug zuweisen/entfernen' },
        { keys: ['⇧', '1'], description: 'Priorität: Niedrig' },
        { keys: ['⇧', '2'], description: 'Priorität: Mittel' },
        { keys: ['⇧', '3'], description: 'Priorität: Hoch' },
        { keys: ['<'], description: 'Status zurück' },
        { keys: ['>'], description: 'Status weiter' },
        { keys: ['Delete'], description: 'Einsatz löschen' },
      ],
    },
    {
      title: 'Einsatz-Navigation',
      icon: ArrowUpDown,
      shortcuts: [
        { keys: ['↑'], description: 'Vorheriger Einsatz' },
        { keys: ['↓'], description: 'Nächster Einsatz' },
        { keys: ['Tab'], description: 'Durchlaufen' },
        { keys: ['['], description: 'Linke Sidebar ein/aus' },
        { keys: [']'], description: 'Rechte Sidebar ein/aus' },
      ],
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto animate-modal-entrance">
        <DialogHeader>
          <DialogTitle className="text-2xl">Tastaturkürzel</DialogTitle>
          <DialogDescription>
            Schneller arbeiten mit Tastatur-Shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Pointer to Cmd+K */}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4 animate-fade-in-up">
            <div className="flex items-center gap-2 mb-2">
              <Kbd className="bg-blue-500/20 hover-key-lift">⌘K</Kbd>
              <span className="text-sm font-semibold">Alle Befehle & Tastaturkürzel</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Drücke Cmd+K (Mac) oder Ctrl+K (Windows) für die vollständige Befehlspalette
            </p>
          </div>

          {/* Categorized Shortcuts */}
          {shortcutCategories.map((category, categoryIdx) => (
            <div
              key={categoryIdx}
              className={cn(
                "animate-category-fade",
                categoryIdx === 1 && "animation-delay-100",
                categoryIdx === 2 && "animation-delay-200",
                categoryIdx === 3 && "animation-delay-300"
              )}
              style={{ animationDelay: `${categoryIdx * 0.1}s` }}
            >
              <div className="flex items-center gap-2 mb-3">
                <category.icon className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-sm uppercase tracking-wide text-foreground">
                  {category.title}
                </h3>
              </div>
              {category.description && (
                <p className="text-xs text-muted-foreground mb-2 ml-7">
                  {category.description}
                </p>
              )}
              <div className="space-y-1.5 ml-7">
                {category.shortcuts.map((shortcut, shortcutIdx) => (
                  <div
                    key={shortcutIdx}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-md bg-secondary/30 hover:bg-secondary/50 transition-all hover-delight",
                      "animate-stagger-fade-in",
                      `stagger-delay-${Math.min(shortcutIdx + 1, 5)}`
                    )}
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, keyIdx) => (
                        <Kbd key={keyIdx} className="h-5 text-xs hover-key-lift">
                          {key}
                        </Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Pro Tip */}
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 animate-tip-pulse">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100 mb-1">
                  Profi-Tipp
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-200">
                  Bewegen Sie die Maus über einen Einsatz (oder wählen Sie ihn mit ↑/↓ aus),
                  um ihn mit Tastenkombinationen zu bearbeiten. Die Tastaturkürzel funktionieren
                  immer auf dem gerade ausgewählten Einsatz.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Home,
  Map,
  Calendar,
  Plus,
  HelpCircle,
  RefreshCw,
  Settings,
  Search,
  Users,
  Package,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  ArrowLeft,
  Keyboard,
  Edit,
  Trash2,
} from "lucide-react"

interface CommandPaletteProps {
  onNewOperation?: () => void
  onShowHelp?: () => void
  onRefresh?: () => void
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
}

export function CommandPalette({
  onNewOperation,
  onShowHelp,
  onRefresh,
  onToggleLeftSidebar,
  onToggleRightSidebar,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Listen for Cmd/Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-lg">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <CommandInput placeholder="Befehl suchen..." />
          <CommandList>
            <CommandEmpty>Keine Ergebnisse gefunden.</CommandEmpty>

            <CommandGroup heading="Navigation">
              <CommandItem
                onSelect={() => runCommand(() => router.push("/"))}
              >
                <Home className="mr-2 h-4 w-4" />
                <span>Kanban-Ansicht</span>
                <span className="ml-auto text-xs text-muted-foreground">G dann K</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/map"))}
              >
                <Map className="mr-2 h-4 w-4" />
                <span>Karten-Ansicht</span>
                <span className="ml-auto text-xs text-muted-foreground">G dann M</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/events"))}
              >
                <Calendar className="mr-2 h-4 w-4" />
                <span>Ereignis-Auswahl</span>
                <span className="ml-auto text-xs text-muted-foreground">G dann E</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Aktionen">
              {onNewOperation && (
                <CommandItem onSelect={() => runCommand(onNewOperation)}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>Neuer Einsatz</span>
                  <span className="ml-auto text-xs text-muted-foreground">N</span>
                </CommandItem>
              )}
              {onRefresh && (
                <CommandItem onSelect={() => runCommand(onRefresh)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  <span>Daten aktualisieren</span>
                  <span className="ml-auto text-xs text-muted-foreground">R oder F5</span>
                </CommandItem>
              )}
              {onShowHelp && (
                <CommandItem onSelect={() => runCommand(onShowHelp)}>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>Tastaturkürzel anzeigen</span>
                  <span className="ml-auto text-xs text-muted-foreground">?</span>
                </CommandItem>
              )}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Ansicht">
              {onToggleLeftSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleLeftSidebar)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>Personen-Seitenleiste umschalten</span>
                  <span className="ml-auto text-xs text-muted-foreground">[</span>
                </CommandItem>
              )}
              {onToggleRightSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleRightSidebar)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>Material-Seitenleiste umschalten</span>
                  <span className="ml-auto text-xs text-muted-foreground">]</span>
                </CommandItem>
              )}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Suche">
              <CommandItem onSelect={() => runCommand(() => document.getElementById('search-input')?.focus())}>
                <Search className="mr-2 h-4 w-4" />
                <span>Einsätze durchsuchen</span>
                <span className="ml-auto text-xs text-muted-foreground">/</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => document.getElementById('personnel-search-input')?.focus())}>
                <Users className="mr-2 h-4 w-4" />
                <span>Personen durchsuchen</span>
                <span className="ml-auto text-xs text-muted-foreground">P</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => document.getElementById('material-search-input')?.focus())}>
                <Package className="mr-2 h-4 w-4" />
                <span>Material durchsuchen</span>
                <span className="ml-auto text-xs text-muted-foreground">M</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Tastaturkürzel">
              <CommandItem disabled>
                <Keyboard className="mr-2 h-4 w-4" />
                <span className="text-xs italic">Drücke ? für Schnellreferenz</span>
              </CommandItem>

              <CommandItem disabled>
                <ArrowUp className="mr-2 h-4 w-4" />
                <span>Einsatz auswählen (hoch)</span>
                <span className="ml-auto text-xs text-muted-foreground">↑</span>
              </CommandItem>
              <CommandItem disabled>
                <ArrowDown className="mr-2 h-4 w-4" />
                <span>Einsatz auswählen (runter)</span>
                <span className="ml-auto text-xs text-muted-foreground">↓</span>
              </CommandItem>
              <CommandItem disabled>
                <Edit className="mr-2 h-4 w-4" />
                <span>Ausgewählten Einsatz bearbeiten</span>
                <span className="ml-auto text-xs text-muted-foreground">E oder Enter</span>
              </CommandItem>
              <CommandItem disabled>
                <ArrowRight className="mr-2 h-4 w-4" />
                <span>Status vorwärts</span>
                <span className="ml-auto text-xs text-muted-foreground">&gt; oder .</span>
              </CommandItem>
              <CommandItem disabled>
                <ArrowLeft className="mr-2 h-4 w-4" />
                <span>Status rückwärts</span>
                <span className="ml-auto text-xs text-muted-foreground">&lt; oder ,</span>
              </CommandItem>
              <CommandItem disabled>
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Ausgewählten Einsatz löschen</span>
                <span className="ml-auto text-xs text-muted-foreground">Delete oder Backspace</span>
              </CommandItem>
              <CommandItem disabled>
                <span className="mr-2 h-4 w-4 flex items-center justify-center font-bold text-xs">1-5</span>
                <span>Fahrzeug zuweisen/entfernen</span>
                <span className="ml-auto text-xs text-muted-foreground">1-5</span>
              </CommandItem>
              <CommandItem disabled>
                <span className="mr-2 h-4 w-4 flex items-center justify-center font-bold text-xs">⇧</span>
                <span>Priorität setzen (Niedrig/Mittel/Hoch)</span>
                <span className="ml-auto text-xs text-muted-foreground">Shift+1/2/3</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

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
  RefreshCw,
  Search,
  Users,
  Package,
  ArrowRight,
  ArrowLeft,
  Edit,
  Trash2,
  Truck,
  Bell,
  AlertTriangle,
  BookOpen,
  Columns,
} from "lucide-react"
import { useCommandPaletteHandlers } from "@/lib/contexts/command-palette-context"

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Get handlers from context
  const {
    onNewOperation,
    onRefresh,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleVehicleStatus,
    onToggleNotifications,
    onEditIncident,
    onDeleteIncident,
    onMoveStatusForward,
    onMoveStatusBackward,
    onAssignVehicle,
    onSetPriority,
    hasSelectedIncident = false,
  } = useCommandPaletteHandlers()

  // Listen for Cmd/Ctrl+K and ? key
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Check if user is typing in an input
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      } else if (e.key === "?" && !isTyping) {
        e.preventDefault()
        setOpen(true)
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
                <span className="ml-auto text-xs text-muted-foreground">G K</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/map"))}
              >
                <Map className="mr-2 h-4 w-4" />
                <span>Karten-Ansicht</span>
                <span className="ml-auto text-xs text-muted-foreground">G M</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/combined"))}
              >
                <Columns className="mr-2 h-4 w-4" />
                <span>Kombinierte Ansicht</span>
                <span className="ml-auto text-xs text-muted-foreground">G C</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/events"))}
              >
                <Calendar className="mr-2 h-4 w-4" />
                <span>Ereignis-Auswahl</span>
                <span className="ml-auto text-xs text-muted-foreground">G E</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/help"))}
              >
                <BookOpen className="mr-2 h-4 w-4" />
                <span>Hilfe & Dokumentation</span>
                <span className="ml-auto text-xs text-muted-foreground">G H</span>
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
              {onToggleVehicleStatus && (
                <CommandItem onSelect={() => runCommand(onToggleVehicleStatus)}>
                  <Truck className="mr-2 h-4 w-4" />
                  <span>Fahrzeugstatus</span>
                  <span className="ml-auto text-xs text-muted-foreground">F</span>
                </CommandItem>
              )}
              {onRefresh && (
                <CommandItem onSelect={() => runCommand(onRefresh)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  <span>Daten aktualisieren</span>
                  <span className="ml-auto text-xs text-muted-foreground">R</span>
                </CommandItem>
              )}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Ansicht">
              {onToggleLeftSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleLeftSidebar)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>Personal-Seitenleiste</span>
                  <span className="ml-auto text-xs text-muted-foreground">[</span>
                </CommandItem>
              )}
              {onToggleRightSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleRightSidebar)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>Material-Seitenleiste</span>
                  <span className="ml-auto text-xs text-muted-foreground">]</span>
                </CommandItem>
              )}
              {onToggleNotifications && (
                <CommandItem onSelect={() => runCommand(onToggleNotifications)}>
                  <Bell className="mr-2 h-4 w-4" />
                  <span>Benachrichtigungen</span>
                  <span className="ml-auto text-xs text-muted-foreground">B</span>
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
                <span>Personal durchsuchen</span>
                <span className="ml-auto text-xs text-muted-foreground">P</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => document.getElementById('material-search-input')?.focus())}>
                <Package className="mr-2 h-4 w-4" />
                <span>Material durchsuchen</span>
                <span className="ml-auto text-xs text-muted-foreground">M</span>
              </CommandItem>
            </CommandGroup>

            {/* Incident-specific actions - only show when an incident is selected */}
            {hasSelectedIncident && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Ausgewählter Einsatz">
                  {onEditIncident && (
                    <CommandItem onSelect={() => runCommand(onEditIncident)}>
                      <Edit className="mr-2 h-4 w-4" />
                      <span>Details öffnen</span>
                      <span className="ml-auto text-xs text-muted-foreground">E</span>
                    </CommandItem>
                  )}
                  {onMoveStatusForward && (
                    <CommandItem onSelect={() => runCommand(onMoveStatusForward)}>
                      <ArrowRight className="mr-2 h-4 w-4" />
                      <span>Status vorwärts</span>
                      <span className="ml-auto text-xs text-muted-foreground">&gt;</span>
                    </CommandItem>
                  )}
                  {onMoveStatusBackward && (
                    <CommandItem onSelect={() => runCommand(onMoveStatusBackward)}>
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      <span>Status zurück</span>
                      <span className="ml-auto text-xs text-muted-foreground">&lt;</span>
                    </CommandItem>
                  )}
                  {onSetPriority && (
                    <>
                      <CommandItem onSelect={() => runCommand(() => onSetPriority('low'))}>
                        <AlertTriangle className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>Priorität: Niedrig</span>
                        <span className="ml-auto text-xs text-muted-foreground">⇧1</span>
                      </CommandItem>
                      <CommandItem onSelect={() => runCommand(() => onSetPriority('medium'))}>
                        <AlertTriangle className="mr-2 h-4 w-4 text-yellow-500" />
                        <span>Priorität: Mittel</span>
                        <span className="ml-auto text-xs text-muted-foreground">⇧2</span>
                      </CommandItem>
                      <CommandItem onSelect={() => runCommand(() => onSetPriority('high'))}>
                        <AlertTriangle className="mr-2 h-4 w-4 text-red-500" />
                        <span>Priorität: Hoch</span>
                        <span className="ml-auto text-xs text-muted-foreground">⇧3</span>
                      </CommandItem>
                    </>
                  )}
                  {onAssignVehicle && (
                    <>
                      <CommandItem onSelect={() => runCommand(() => onAssignVehicle(1))}>
                        <Truck className="mr-2 h-4 w-4" />
                        <span>Fahrzeug 1 zuweisen/entfernen</span>
                        <span className="ml-auto text-xs text-muted-foreground">1</span>
                      </CommandItem>
                      <CommandItem onSelect={() => runCommand(() => onAssignVehicle(2))}>
                        <Truck className="mr-2 h-4 w-4" />
                        <span>Fahrzeug 2 zuweisen/entfernen</span>
                        <span className="ml-auto text-xs text-muted-foreground">2</span>
                      </CommandItem>
                      <CommandItem onSelect={() => runCommand(() => onAssignVehicle(3))}>
                        <Truck className="mr-2 h-4 w-4" />
                        <span>Fahrzeug 3 zuweisen/entfernen</span>
                        <span className="ml-auto text-xs text-muted-foreground">3</span>
                      </CommandItem>
                      <CommandItem onSelect={() => runCommand(() => onAssignVehicle(4))}>
                        <Truck className="mr-2 h-4 w-4" />
                        <span>Fahrzeug 4 zuweisen/entfernen</span>
                        <span className="ml-auto text-xs text-muted-foreground">4</span>
                      </CommandItem>
                      <CommandItem onSelect={() => runCommand(() => onAssignVehicle(5))}>
                        <Truck className="mr-2 h-4 w-4" />
                        <span>Fahrzeug 5 zuweisen/entfernen</span>
                        <span className="ml-auto text-xs text-muted-foreground">5</span>
                      </CommandItem>
                    </>
                  )}
                  {onDeleteIncident && (
                    <CommandItem onSelect={() => runCommand(onDeleteIncident)}>
                      <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                      <span className="text-destructive">Einsatz löschen</span>
                      <span className="ml-auto text-xs text-muted-foreground">Del</span>
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
  Settings,
  PanelRight,
  Footprints,
  Tag,
  Route,
  Crosshair,
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
    onToggleSidePanel,
    onSidePanelDetail,
    onSidePanelMap,
    onSearchPersonnel,
    onSearchMaterial,
    onEditIncident,
    onDeleteIncident,
    onMoveStatusForward,
    onMoveStatusBackward,
    onAssignVehicle,
    onSetPriority,
    onToggleZuFuss,
    onToggleMapLabels,
    onToggleMapLines,
    onFocusVehicle,
    mapVehicleNames = [],
    hasSelectedIncident = false,
  } = useCommandPaletteHandlers()

  // Helper: bind incident-bound handlers only when one is hovered/selected,
  // otherwise the CommandItem stays visible but `disabled` greys it out.
  const incidentOnly = (fn?: () => void) => (hasSelectedIncident ? fn : undefined)

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
      <DialogContent className="overflow-hidden p-0 shadow-lg" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Befehlspalette</DialogTitle>
          <DialogDescription>Suche und führe Befehle aus.</DialogDescription>
        </DialogHeader>
        <Command className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <CommandInput placeholder="Befehl suchen..." showClose />
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
              <CommandItem
                onSelect={() => runCommand(() => router.push("/settings"))}
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>Einstellungen</span>
                <span className="ml-auto text-xs text-muted-foreground">G S</span>
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
                  <span className="ml-auto text-xs text-muted-foreground">Q / [</span>
                </CommandItem>
              )}
              {onToggleRightSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleRightSidebar)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>Material-Seitenleiste</span>
                  <span className="ml-auto text-xs text-muted-foreground">W / ]</span>
                </CommandItem>
              )}
              {onToggleNotifications && (
                <CommandItem onSelect={() => runCommand(onToggleNotifications)}>
                  <Bell className="mr-2 h-4 w-4" />
                  <span>Benachrichtigungen</span>
                  <span className="ml-auto text-xs text-muted-foreground">B</span>
                </CommandItem>
              )}
              {onToggleSidePanel && (
                <CommandItem onSelect={() => runCommand(onToggleSidePanel)}>
                  <PanelRight className="mr-2 h-4 w-4" />
                  <span>Seitenpanel umschalten</span>
                  <span className="ml-auto text-xs text-muted-foreground">I / \</span>
                </CommandItem>
              )}
              {onSidePanelDetail && (
                <CommandItem onSelect={() => runCommand(onSidePanelDetail)}>
                  <Edit className="mr-2 h-4 w-4" />
                  <span>Seitenpanel: Detail</span>
                  <span className="ml-auto text-xs text-muted-foreground">D</span>
                </CommandItem>
              )}
              {onSidePanelMap && (
                <CommandItem onSelect={() => runCommand(onSidePanelMap)}>
                  <Map className="mr-2 h-4 w-4" />
                  <span>Seitenpanel: Karte</span>
                  <span className="ml-auto text-xs text-muted-foreground">K</span>
                </CommandItem>
              )}
            </CommandGroup>

            {(onToggleMapLabels || onToggleMapLines || onFocusVehicle) && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Karte">
                  {onToggleMapLabels && (
                    <CommandItem onSelect={() => runCommand(onToggleMapLabels)}>
                      <Tag className="mr-2 h-4 w-4" />
                      <span>Labels umschalten</span>
                      <span className="ml-auto text-xs text-muted-foreground">L</span>
                    </CommandItem>
                  )}
                  {onToggleMapLines && (
                    <CommandItem onSelect={() => runCommand(onToggleMapLines)}>
                      <Route className="mr-2 h-4 w-4" />
                      <span>Zuweisungslinien umschalten</span>
                      <span className="ml-auto text-xs text-muted-foreground">I</span>
                    </CommandItem>
                  )}
                  {onFocusVehicle &&
                    [1, 2, 3, 4, 5].map((n) => (
                      <CommandItem
                        key={`focus-vehicle-${n}`}
                        onSelect={() => runCommand(() => onFocusVehicle?.(n))}
                      >
                        <Crosshair className="mr-2 h-4 w-4" />
                        <span>{mapVehicleNames[n - 1] ? `${mapVehicleNames[n - 1]} anzeigen` : `Fahrzeug ${n} anzeigen`}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />

            <CommandGroup heading="Suche">
              <CommandItem onSelect={() => runCommand(() => document.getElementById('search-input')?.focus())}>
                <Search className="mr-2 h-4 w-4" />
                <span>Einsätze durchsuchen</span>
                <span className="ml-auto text-xs text-muted-foreground">S / /</span>
              </CommandItem>
              {onSearchPersonnel && (
                <CommandItem onSelect={() => runCommand(onSearchPersonnel)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>Personal durchsuchen</span>
                  <span className="ml-auto text-xs text-muted-foreground">P</span>
                </CommandItem>
              )}
              {onSearchMaterial && (
                <CommandItem onSelect={() => runCommand(onSearchMaterial)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>Material durchsuchen</span>
                  <span className="ml-auto text-xs text-muted-foreground">M</span>
                </CommandItem>
              )}
            </CommandGroup>

            {/* Incident-specific actions — always shown so operators see the
                full shortcut list; entries are `disabled` (greyed out) when no
                op is hovered/selected. */}
            <CommandSeparator />
            <CommandGroup heading={hasSelectedIncident ? "Ausgewählter Einsatz" : "Einsatz (Maus über einen Einsatz)"}>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onEditIncident)?.())}
              >
                <Edit className="mr-2 h-4 w-4" />
                <span>Details öffnen</span>
                <span className="ml-auto text-xs text-muted-foreground">E</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onMoveStatusForward)?.())}
              >
                <ArrowRight className="mr-2 h-4 w-4" />
                <span>Status vorwärts</span>
                <span className="ml-auto text-xs text-muted-foreground">&gt;</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onMoveStatusBackward)?.())}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                <span>Status zurück</span>
                <span className="ml-auto text-xs text-muted-foreground">&lt;</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('low') : undefined))
                }
              >
                <AlertTriangle className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>Priorität: Niedrig</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧1</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('medium') : undefined))
                }
              >
                <AlertTriangle className="mr-2 h-4 w-4 text-yellow-500" />
                <span>Priorität: Mittel</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧2</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('high') : undefined))
                }
              >
                <AlertTriangle className="mr-2 h-4 w-4 text-red-500" />
                <span>Priorität: Hoch</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧3</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onToggleZuFuss)?.())}
              >
                <Footprints className="mr-2 h-4 w-4" />
                <span>Zu Fuss umschalten</span>
                <span className="ml-auto text-xs text-muted-foreground">0</span>
              </CommandItem>
              {[1, 2, 3, 4, 5].map((n) => (
                <CommandItem
                  key={`assign-vehicle-${n}`}
                  disabled={!hasSelectedIncident}
                  onSelect={() =>
                    runCommand(() => (hasSelectedIncident ? onAssignVehicle?.(n) : undefined))
                  }
                >
                  <Truck className="mr-2 h-4 w-4" />
                  <span>Fahrzeug {n} zuweisen/entfernen</span>
                  <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                </CommandItem>
              ))}
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onDeleteIncident)?.())}
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                <span className="text-destructive">Einsatz löschen</span>
                <span className="ml-auto text-xs text-muted-foreground">Del</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

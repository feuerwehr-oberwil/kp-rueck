"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
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
  BookOpen,
  Settings,
  PanelRight,
  Footprints,
  Tag,
  Route,
  Crosshair,
  ChevronDown,
  Waypoints,
  Printer,
} from "lucide-react"
import { useCommandPaletteHandlers } from "@/lib/contexts/command-palette-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { PRIORITY_ICONS, PRIORITY_TEXT_CLASSES } from "@/lib/priority"

/** Window event that opens the palette (for mouse entry points like the welcome card). */
export const OPEN_COMMAND_PALETTE_EVENT = "kp:open-command-palette"

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT))
}

export function CommandPalette() {
  const t = useTranslations('common.commandPalette')
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Get handlers from context
  const {
    onNewOperation,
    onRefresh,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleVehicleStatus,
    onToggleAuftraege,
    onTogglePrint,
    onOpenAuftrag,
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
    onMapResetZoom,
    mapVehicleNames = [],
    onFocusIncidentSearch,
    hasSelectedIncident = false,
  } = useCommandPaletteHandlers()

  // Aufträge (routes) are searchable by name; selecting one opens the Aufträge
  // sheet focused on that route. Only surfaced where the host page registered the
  // open handler (the Kanban dashboard) so the palette never lists dead entries.
  const { groups } = useGroups()

  // Helper: bind incident-bound handlers only when one is hovered/selected,
  // otherwise the CommandItem stays visible but `disabled` greys it out.
  const incidentOnly = (fn?: () => void) => (hasSelectedIncident ? fn : undefined)

  // Listen for Cmd/Ctrl+K and the programmatic open event
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // toLowerCase so Caps Lock / Shift (e.key === "K") still opens it.
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    const openFromEvent = () => setOpen(true)

    document.addEventListener("keydown", down)
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openFromEvent)
    return () => {
      document.removeEventListener("keydown", down)
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openFromEvent)
    }
  }, [])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  // Scroll affordance: when the command list overflows (and isn't scrolled to
  // the bottom) show a bottom fade + chevron, so it's obvious more items exist
  // even when the list wraps exactly after an item.
  const listWrapperRef = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(false)
  useEffect(() => {
    if (!open) return
    const wrap = listWrapperRef.current
    const list = wrap?.querySelector('[data-slot="command-list"]') as HTMLElement | null
    if (!list) return
    const recompute = () =>
      setCanScrollDown(list.scrollHeight - list.scrollTop - list.clientHeight > 4)
    recompute()
    list.addEventListener("scroll", recompute)
    const ro = new ResizeObserver(recompute)
    ro.observe(list)
    if (list.firstElementChild) ro.observe(list.firstElementChild)
    return () => {
      list.removeEventListener("scroll", recompute)
      ro.disconnect()
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-lg" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <Command className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <CommandInput placeholder={t('searchPlaceholder')} showClose />
          <div ref={listWrapperRef} className="relative">
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>

            <CommandGroup heading={t('groupNavigation')}>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/"))}
              >
                <Home className="mr-2 h-4 w-4" />
                <span>{t('kanbanView')}</span>
                <span className="ml-auto text-xs text-muted-foreground">G K</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/map"))}
              >
                <Map className="mr-2 h-4 w-4" />
                <span>{t('mapView')}</span>
                <span className="ml-auto text-xs text-muted-foreground">G M</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/events"))}
              >
                <Calendar className="mr-2 h-4 w-4" />
                <span>{t('eventSelection')}</span>
                <span className="ml-auto text-xs text-muted-foreground">G E</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/help"))}
              >
                <BookOpen className="mr-2 h-4 w-4" />
                <span>{t('helpDocs')}</span>
                <span className="ml-auto text-xs text-muted-foreground">G H</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/settings"))}
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>{t('settings')}</span>
                <span className="ml-auto text-xs text-muted-foreground">G S</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading={t('groupActions')}>
              {onNewOperation && (
                <CommandItem onSelect={() => runCommand(onNewOperation)}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>{t('newIncident')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">N</span>
                </CommandItem>
              )}
              {onToggleVehicleStatus && (
                <CommandItem onSelect={() => runCommand(onToggleVehicleStatus)}>
                  <Truck className="mr-2 h-4 w-4" />
                  <span>{t('vehicleStatus')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">F</span>
                </CommandItem>
              )}
              {onToggleAuftraege && (
                <CommandItem onSelect={() => runCommand(onToggleAuftraege)}>
                  <Waypoints className="mr-2 h-4 w-4" />
                  <span>{t('auftraege')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">A</span>
                </CommandItem>
              )}
              {onTogglePrint && (
                <CommandItem onSelect={() => runCommand(onTogglePrint)}>
                  <Printer className="mr-2 h-4 w-4" />
                  <span>{t('print')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">D</span>
                </CommandItem>
              )}
              {onRefresh && (
                <CommandItem onSelect={() => runCommand(onRefresh)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  <span>{t('refreshData')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">R</span>
                </CommandItem>
              )}
            </CommandGroup>

            {onOpenAuftrag && groups.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('groupAuftraege')}>
                  {groups.map((group) => (
                    <CommandItem
                      key={group.id}
                      value={`auftrag ${group.name} ${group.id}`}
                      onSelect={() => runCommand(() => onOpenAuftrag(group.id))}
                    >
                      <span
                        className="mr-2 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
                        aria-hidden
                      />
                      <span className="truncate">{group.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />

            <CommandGroup heading={t('groupView')}>
              {onToggleLeftSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleLeftSidebar)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>{t('personnelSidebar')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Q / [</span>
                </CommandItem>
              )}
              {onToggleRightSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleRightSidebar)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>{t('materialSidebar')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">W / ]</span>
                </CommandItem>
              )}
              {onToggleNotifications && (
                <CommandItem onSelect={() => runCommand(onToggleNotifications)}>
                  <Bell className="mr-2 h-4 w-4" />
                  <span>{t('notifications')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">B</span>
                </CommandItem>
              )}
              {onToggleSidePanel && (
                <CommandItem onSelect={() => runCommand(onToggleSidePanel)}>
                  <PanelRight className="mr-2 h-4 w-4" />
                  <span>{t('toggleSidePanel')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">I / \</span>
                </CommandItem>
              )}
              {/* No shortcut hint on purpose: `d` used to open the panel on
                  Detail and now opens the Drucken-Sheet (see
                  `lib/hooks/use-kanban-shortcuts.ts`). Nothing binds to this
                  command any more — it lives here and nowhere else. */}
              {onSidePanelDetail && (
                <CommandItem onSelect={() => runCommand(onSidePanelDetail)}>
                  <Edit className="mr-2 h-4 w-4" />
                  <span>{t('sidePanelDetail')}</span>
                </CommandItem>
              )}
              {onSidePanelMap && (
                <CommandItem onSelect={() => runCommand(onSidePanelMap)}>
                  <Map className="mr-2 h-4 w-4" />
                  <span>{t('sidePanelMap')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">K</span>
                </CommandItem>
              )}
            </CommandGroup>

            {(onToggleMapLabels || onToggleMapLines || onFocusVehicle) && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('groupMap')}>
                  {onToggleMapLabels && (
                    <CommandItem onSelect={() => runCommand(onToggleMapLabels)}>
                      <Tag className="mr-2 h-4 w-4" />
                      <span>{t('toggleLabels')}</span>
                      <span className="ml-auto text-xs text-muted-foreground">L</span>
                    </CommandItem>
                  )}
                  {onToggleMapLines && (
                    <CommandItem onSelect={() => runCommand(onToggleMapLines)}>
                      <Route className="mr-2 h-4 w-4" />
                      <span>{t('toggleAssignmentLines')}</span>
                      <span className="ml-auto text-xs text-muted-foreground">I</span>
                    </CommandItem>
                  )}
                  {onMapResetZoom && (
                    <CommandItem onSelect={() => runCommand(onMapResetZoom)}>
                      <Crosshair className="mr-2 h-4 w-4" />
                      <span>{t('resetZoom')}</span>
                      <span className="ml-auto text-xs text-muted-foreground">Z</span>
                    </CommandItem>
                  )}
                  {onFocusVehicle &&
                    [1, 2, 3, 4, 5].map((n) => (
                      <CommandItem
                        key={`focus-vehicle-${n}`}
                        onSelect={() => runCommand(() => onFocusVehicle?.(n))}
                      >
                        <Crosshair className="mr-2 h-4 w-4" />
                        <span>{mapVehicleNames[n - 1] ? t('showVehicleNamed', { name: mapVehicleNames[n - 1] }) : t('showVehicleNumber', { number: n })}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />

            <CommandGroup heading={t('groupSearch')}>
              <CommandItem
                onSelect={() =>
                  runCommand(onFocusIncidentSearch ?? (() => document.getElementById('search-input')?.focus()))
                }
              >
                <Search className="mr-2 h-4 w-4" />
                <span>{t('searchIncidents')}</span>
                <span className="ml-auto text-xs text-muted-foreground">S / /</span>
              </CommandItem>
              {onSearchPersonnel && (
                <CommandItem onSelect={() => runCommand(onSearchPersonnel)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>{t('searchPersonnel')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">P</span>
                </CommandItem>
              )}
              {onSearchMaterial && (
                <CommandItem onSelect={() => runCommand(onSearchMaterial)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>{t('searchMaterial')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">M</span>
                </CommandItem>
              )}
            </CommandGroup>

            {/* Incident-specific actions — always shown so operators see the
                full shortcut list; entries are `disabled` (greyed out) when no
                op is hovered/selected. */}
            <CommandSeparator />
            <CommandGroup heading={hasSelectedIncident ? t('groupSelectedIncident') : t('groupIncidentHover')}>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onEditIncident)?.())}
              >
                <Edit className="mr-2 h-4 w-4" />
                <span>{t('openDetails')}</span>
                <span className="ml-auto text-xs text-muted-foreground">E</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onMoveStatusForward)?.())}
              >
                <ArrowRight className="mr-2 h-4 w-4" />
                <span>{t('statusForward')}</span>
                <span className="ml-auto text-xs text-muted-foreground">&gt;</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onMoveStatusBackward)?.())}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                <span>{t('statusBackward')}</span>
                <span className="ml-auto text-xs text-muted-foreground">&lt;</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('low') : undefined))
                }
              >
                <PRIORITY_ICONS.low className={`mr-2 h-4 w-4 ${PRIORITY_TEXT_CLASSES.low}`} />
                <span>{t('priorityLow')}</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧1</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('medium') : undefined))
                }
              >
                <PRIORITY_ICONS.medium className={`mr-2 h-4 w-4 ${PRIORITY_TEXT_CLASSES.medium}`} />
                <span>{t('priorityMedium')}</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧2</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('high') : undefined))
                }
              >
                <PRIORITY_ICONS.high className={`mr-2 h-4 w-4 ${PRIORITY_TEXT_CLASSES.high}`} />
                <span>{t('priorityHigh')}</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧3</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onToggleZuFuss)?.())}
              >
                <Footprints className="mr-2 h-4 w-4" />
                <span>{t('toggleZuFuss')}</span>
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
                  <span>{t('assignVehicle', { number: n })}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                </CommandItem>
              ))}
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onDeleteIncident)?.())}
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                <span className="text-destructive">{t('deleteIncident')}</span>
                <span className="ml-auto text-xs text-muted-foreground">Del</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
          {canScrollDown && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-9 items-end justify-center bg-gradient-to-t from-popover via-popover/80 to-transparent">
              <ChevronDown className="mb-1 h-4 w-4 animate-bounce text-muted-foreground" />
            </div>
          )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

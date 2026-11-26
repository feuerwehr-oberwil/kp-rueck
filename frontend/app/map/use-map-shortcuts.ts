import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { openCommandPalette } from "@/components/ui/command-palette"
import { useCommandPalette } from "@/lib/contexts/command-palette-context"
import type { VehicleShortcut } from "@/lib/contexts/operations/use-vehicle-shortcuts"
import { useGPrefixNavigation } from "@/lib/hooks/use-g-prefix-navigation"
// The board's shortcut hook owns the canonical "should this keystroke reach the
// page?" rules; the map answers the same questions and reuses them.
import { isActivationTarget, isOverlayOpen } from "@/lib/hooks/use-kanban-shortcuts"
import type { MapIncident } from "@/lib/map-incident"
import { isTypingTarget } from "@/lib/typing-target"
import type { MapViewChange } from "./map-view-options"
import { COLOR_BY_SHORTCUTS } from "./view-menu"

/**
 * The Lagekarte's keyboard: the page's single-letter shortcuts, the G-prefix navigation and the
 * command palette's (Cmd+K) map handlers. `changeView`, `resetZoom` and `focusVehicle` must be
 * stable – the palette registration is a setState in its context and re-runs when they change.
 */
export function useMapShortcuts({
  selectedIncidentId,
  incidents,
  gpsAvailable,
  vehicleTypes,
  refreshIncidents,
  openIncidentDetail,
  changeView,
  resetZoom,
  focusVehicle,
}: {
  selectedIncidentId: string | null
  incidents: MapIncident[]
  /** Without GPS there are no Zuweisungslinien, so `i` does nothing. */
  gpsAvailable: boolean
  /** The board's numbering (display_order), so «3» is the same truck on both screens. */
  vehicleTypes: VehicleShortcut[]
  refreshIncidents: () => void
  openIncidentDetail: (incidentId: string) => void
  changeView: (change: MapViewChange) => void
  /** Zooms back out and clears the selection. */
  resetZoom: () => void
  focusVehicle: (vehicleName: string) => void
}) {
  const router = useRouter()
  const gPrefix = useGPrefixNavigation(router, '/map')

  // Register command palette (Cmd+K) handlers for the map view
  const { registerHandlers, clearHandlers } = useCommandPalette()
  useEffect(() => {
    // Zoom in on a vehicle by its 1-5 shortcut number
    const focusVehicleByNumber = (vehicleNumber: number) => {
      const vehicle = vehicleTypes.find((item) => item.key === String(vehicleNumber))
      if (vehicle) focusVehicle(vehicle.name)
    }
    registerHandlers({
      onRefresh: () => refreshIncidents(),
      onToggleMapLabels: () => changeView({ type: 'toggle', option: 'showLabels' }),
      onToggleMapLines: () => changeView({ type: 'toggle', option: 'showAssignmentLines' }),
      onFocusVehicle: focusVehicleByNumber,
      onMapResetZoom: resetZoom,
      onSetMapColorBy: (colorBy) => changeView({ type: 'colorBy', colorBy }),
      // Indexed by shortcut number − 1, as the palette lists «1»…«5».
      mapVehicleNames: [1, 2, 3, 4, 5].map((n) => vehicleTypes.find((v) => v.key === String(n))?.name ?? ''),
      onFocusIncidentSearch: () => document.getElementById('map-search-input')?.focus(),
    })
    return () => clearHandlers()
  }, [registerHandlers, clearHandlers, refreshIncidents, vehicleTypes, changeView, resetZoom, focusVehicle])

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Esc to blur input or cancel g-prefix mode
      if (e.key === 'Escape') {
        if (gPrefix.cancel()) return
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          (e.target as HTMLElement).blur()
          return
        }
      }

      // Ignore if typing in a field, and stand down while an overlay is up.
      // Every overlay on this page is modal (detail modal, Ressourcen- and
      // Auftrag-Dialoge, the Ansicht/Modus menus), so an open one owns the
      // keyboard outright — without this, `l` both walked the open menu's
      // typeahead and toggled the marker labels behind it.
      if (isTypingTarget(e.target)) return
      if (isOverlayOpen()) return

      // g-prefix navigation. Must sit BEFORE the single-letter shortcuts below:
      // `s` alone focuses the search, `G S` opens the settings, and only the hook
      // knows which of the two a keystroke is.
      if (gPrefix.handleKey(e)) return

      // `?` opens the command palette here too — the help lists it as global.
      if (e.key === '?') {
        e.preventDefault()
        openCommandPalette()
        return
      }

      // '/' or 'S' key to focus search (S for Suche - Swiss-German keyboard friendly)
      if (e.key === '/' || ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        document.getElementById('map-search-input')?.focus()
      }
      // 'z' key to reset zoom
      else if ((e.key === 'z' || e.key === 'Z') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys (allows cmd+z/ctrl+z for undo)
        e.preventDefault()
        resetZoom()
      }
      // Enter or Space opens details for the selected incident. Both are the
      // activation keys of whatever has focus, so they only mean "open details"
      // while focus is not on a button or link — same keys and rule as the board
      // (`E` is «Eintrag schreiben» there, so it does not open anything here).
      else if (
        (e.key === 'Enter' || e.key === ' ') &&
        !isActivationTarget(e.target) &&
        selectedIncidentId
      ) {
        e.preventDefault()
        const incident = incidents.find(inc => inc.id === selectedIncidentId)
        if (incident) {
          openIncidentDetail(incident.id)
        }
      }
      // 'r' or 'F5' key to refresh data
      else if ((e.key === 'r' || e.key === 'R' || e.key === 'F5') && !e.metaKey && !e.ctrlKey) {
        // Only prevent default if no modifier keys are pressed
        // This allows cmd+r / ctrl+r to work normally for browser refresh
        e.preventDefault()
        refreshIncidents()
      }
      // 'l' key to toggle marker labels
      else if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        changeView({ type: 'toggle', option: 'showLabels' })
      }
      // 'i' key to toggle assignment lines (only with GPS — see gpsAvailable)
      else if ((e.key === 'i' || e.key === 'I') && !e.metaKey && !e.ctrlKey && gpsAvailable) {
        e.preventDefault()
        changeView({ type: 'toggle', option: 'showAssignmentLines' })
      }
      // '1'-'5' keys to zoom in on the corresponding vehicle
      else if (e.key >= '1' && e.key <= '5' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const vehicle = vehicleTypes.find((v) => v.key === e.key)
        if (vehicle) {
          e.preventDefault()
          focusVehicle(vehicle.name)
        }
      }
      // 'p'/'k'/'f'/'t'/'a' pick the "Färben nach" dimension — exactly a menu
      // click, so the Reko-Editor and route-overlay colour overrides behave the
      // same as if the Ansicht menu item had been chosen.
      else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const colorDim = COLOR_BY_SHORTCUTS.find(([key]) => key === e.key.toLowerCase())?.[1]
        if (colorDim) {
          e.preventDefault()
          changeView({ type: 'colorBy', colorBy: colorDim })
        }
      }
      // Arrow keys to pan the map are not wired up from this page: it has no handle on the
      // map instance. MapLibre's own keyboard handler pans once the canvas has focus, which
      // covers the case for now.
    }

    window.addEventListener('keydown', handleKeyPress)
    // (the prefix timer is the hook's to clear)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [gPrefix, selectedIncidentId, incidents, refreshIncidents, openIncidentDetail, vehicleTypes, gpsAvailable, changeView, resetZoom, focusVehicle])
}

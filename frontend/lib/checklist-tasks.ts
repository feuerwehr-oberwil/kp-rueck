import { LucideIcon, MessageCircle, Users, Truck, Package, Map, Printer, Copy } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

export interface ChecklistAction {
  label: string
  icon: LucideIcon
  variant: 'default' | 'outline' | 'secondary' | 'ghost'
  onClick?: () => void
  href?: string
}

export interface ChecklistTask {
  id: string
  title: string
  description: string
  icon: LucideIcon
  priority: 'critical' | 'recommended' | 'optional'
  /** Whether this row offers the two-message WhatsApp picker instead of a plain action. */
  isWhatsApp?: boolean
  actionButtons?: ChecklistAction[]
}

export interface ChecklistTaskState extends ChecklistTask {
  completed: boolean
  metadata?: {
    count?: number
    total?: number
    details?: string
  }
}

// Editable WhatsApp templates (defaults used until an editor overrides them in Settings)
export const WHATSAPP_MESSAGE_1_KEY = 'whatsapp_message_1'
export const WHATSAPP_MESSAGE_2_KEY = 'whatsapp_message_2'

export const DEFAULT_WHATSAPP_MESSAGE_1 = `KP-Rück ist aktiv. Bitte im Einsatzfall Telefon mitnehmen.

1. Bei *jeder* Pager Meldung (ausser Brand) ins Magazin einrücken
2. Wenn vor Ort, in Atemschutzraum besammeln
3. Auf weitere Anweisungen warten
4. Bei Unklarheiten auf diese Nummer antworten`

export const DEFAULT_WHATSAPP_MESSAGE_2 = `KP-Rück ist aktiv. Bitte Telefon mitnehmen.
1. Ins Magazin einrücken!
2. In Atemschutzraum besammeln
3. Auf weitere Anweisungen warten
4. Bei Unklarheiten auf diese Nummer antworten.`

/** Resolve a stored WhatsApp template, falling back to the default when unset/blank. */
export function resolveWhatsAppMessage(
  settings: Record<string, string>,
  key: string,
  fallback: string
): string {
  const stored = settings[key]
  return stored && stored.trim() ? stored : fallback
}

/**
 * Generate checklist tasks with current state.
 *
 * Link-sharing rows (check-in, Reko, Alarm) adapt their action: when a thermal
 * printer is reachable they print the QR, otherwise they copy the link. The
 * WhatsApp row is handled specially by the component (two-message picker).
 */
export function generateChecklistTasks(params: {
  eventId: string
  checkedInPersonnel: number
  totalVehicles: number
  driverAssignments: number
  rekoOfficers: number
  magazinStaff: number
  mapTilesAvailable: boolean
  printerEnabled: boolean
  printerAgentOnline: boolean
  onCopyCheckInLink: () => void
  onPrintCheckInLink: () => void
  onCopyRekoLink: () => void
  onPrintRekoLink: () => void
  onCopyAlarmLink: () => void
  onPrintAlarmLink: () => void
  onShowTileSetup: () => void
  onTestPrint: () => void
}): ChecklistTaskState[] {
  const printerAvailable = params.printerEnabled && params.printerAgentOnline

  // A link row prints the QR when a printer is reachable, otherwise copies the link.
  const linkAction = (onCopy: () => void, onPrint: () => void): ChecklistAction =>
    printerAvailable
      ? { label: 'QR drucken', icon: Printer, variant: 'default', onClick: onPrint }
      : { label: 'Link kopieren', icon: Copy, variant: 'default', onClick: onCopy }

  return [
    // 1. Send first WhatsApp notification (two-message picker, handled in component).
    // Manual tick only — copying a message must not auto-complete it, so the
    // operator can re-copy as often as needed and check it off when truly sent.
    {
      id: 'send-first-whatsapp',
      title: 'Erste Info-WhatsApp senden',
      description: 'Mannschaft über Ereignis informieren',
      icon: MessageCircle,
      priority: 'recommended',
      isWhatsApp: true,
      completed: false
    },

    // 2. Check in personnel (Critical) — share link or print QR
    {
      id: 'personnel-checkin',
      title: 'Personal einchecken',
      description: 'Mindestens 3 Personen für Einsatzbereitschaft',
      icon: Users,
      priority: 'critical',
      completed: params.checkedInPersonnel >= 3,
      metadata: {
        count: params.checkedInPersonnel,
        details: `${params.checkedInPersonnel} Person${params.checkedInPersonnel !== 1 ? 'en' : ''} eingecheckt`
      },
      actionButtons: [linkAction(params.onCopyCheckInLink, params.onPrintCheckInLink)]
    },

    // 3. Share Reko link — share link or print QR
    {
      id: 'share-reko-link',
      title: 'Reko-Link teilen',
      description: 'Reko-Personal Zugang zum Reko-Dashboard geben',
      icon: Map,
      priority: 'recommended',
      completed: false,
      actionButtons: [linkAction(params.onCopyRekoLink, params.onPrintRekoLink)]
    },

    // 4. Share Alarm link — share link or print QR
    {
      id: 'share-alarm-link',
      title: 'Alarm-Link teilen',
      description: 'Telefon-/Walk-in-Meldungen ermöglichen',
      icon: MessageCircle,
      priority: 'recommended',
      completed: false,
      actionButtons: [linkAction(params.onCopyAlarmLink, params.onPrintAlarmLink)]
    },

    // 5. Assign reconnaissance officers (bullet reminder, no action)
    {
      id: 'assign-reko',
      title: 'Reko-Offiziere bestimmen',
      description: 'Mindestens 1 Person für Rekognoszierung',
      icon: Users,
      priority: 'recommended',
      completed: params.rekoOfficers >= 1,
      metadata: {
        count: params.rekoOfficers,
        details: `${params.rekoOfficers} Reko-Offizier${params.rekoOfficers !== 1 ? 'e' : ''} zugewiesen`
      }
    },

    // 6. Assign drivers (bullet reminder, no action)
    {
      id: 'assign-drivers',
      title: 'Fahrzeug-Fahrer zuweisen',
      description: 'Alle Fahrzeuge benötigen einen Fahrer',
      icon: Truck,
      priority: 'critical',
      completed: params.driverAssignments >= params.totalVehicles && params.totalVehicles > 0,
      metadata: {
        count: params.driverAssignments,
        total: params.totalVehicles,
        details: `${params.driverAssignments}/${params.totalVehicles} Fahrzeuge haben Fahrer`
      }
    },

    // 7. Assign magazin staff (bullet reminder, no action)
    {
      id: 'assign-magazin',
      title: 'Magazin-Personal zuweisen',
      description: 'Optional: Person für Material-Ausgabe',
      icon: Package,
      priority: 'optional',
      completed: params.magazinStaff >= 1,
      metadata: {
        details: params.magazinStaff >= 1
          ? `${params.magazinStaff} Person${params.magazinStaff !== 1 ? 'en' : ''} zugewiesen`
          : 'Noch nicht zugewiesen'
      }
    },

    // 8. Printer reachable — verify each callout (config is one-time, reachability is not)
    {
      id: 'printer-ready',
      title: 'Drucker bereit',
      description: 'Testdruck bestätigt, dass Einsatzzettel gedruckt werden können',
      icon: Printer,
      priority: 'recommended',
      // Not blocking when the printer is intentionally disabled; otherwise the
      // Pi print-agent must be online (its IP drifts via DHCP — a classic
      // "warum druckt es nicht" failure a rare user only finds at the worst moment).
      completed: !params.printerEnabled || params.printerAgentOnline,
      metadata: {
        details: !params.printerEnabled
          ? 'Drucker deaktiviert'
          : params.printerAgentOnline
            ? 'Drucker erreichbar'
            : 'Print-Service offline'
      },
      actionButtons: [
        {
          label: 'Testdruck',
          icon: Printer,
          variant: 'default',
          onClick: params.onTestPrint
        }
      ]
    },

    // 9. Configure offline maps (Optional)
    {
      id: 'configure-map-mode',
      title: 'Offline-Karten einrichten',
      description: 'Optional: Karten ohne Internet nutzen',
      icon: Map,
      priority: 'optional',
      completed: params.mapTilesAvailable,
      metadata: {
        details: params.mapTilesAvailable ? 'Offline-Karten verfügbar' : 'Nicht eingerichtet'
      },
      actionButtons: [
        {
          label: 'Karten-Setup',
          icon: Map,
          variant: 'outline',
          onClick: params.onShowTileSetup
        }
      ]
    }
  ]
}

/** localStorage key holding the operator's explicit tick/un-tick overrides per event. */
export function checklistOverridesKey(eventId: string): string {
  return `checklist-overrides-${eventId}`
}

/**
 * Effective completion = the operator's explicit override if set, otherwise the
 * auto-detected state. Every row is freely tickable AND un-tickable.
 */
export function isTaskComplete(
  task: ChecklistTaskState,
  overrides: Record<string, boolean>
): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, task.id)
    ? overrides[task.id]
    : task.completed
}

/**
 * Fetch live state and summarise checklist completion using the SAME rules as
 * generateChecklistTasks (single source of truth). Used by the persistent
 * "Bereitschaft" badge so it stays live even when the popover is closed.
 */
export async function summarizeEventChecklist(
  eventId: string
): Promise<{ completed: number; total: number; allComplete: boolean }> {
  const [attendance, specialFunctions, vehicles, printerStatus] = await Promise.all([
    apiClient.getEventAttendance(eventId).catch(() => []),
    apiClient.getEventSpecialFunctions(eventId).catch(() => []),
    apiClient.getVehicles().catch(() => []),
    apiClient.getPrinterStatus().catch(() => null),
  ])

  let mapTilesAvailable = false
  try {
    mapTilesAvailable = (await fetch('http://localhost:8080/health')).ok
  } catch {
    mapTilesAvailable = false
  }

  const noop = () => {}
  const tasks = generateChecklistTasks({
    eventId,
    checkedInPersonnel: attendance.filter((a) => a.checked_in).length,
    totalVehicles: vehicles.length,
    driverAssignments: specialFunctions.filter((f) => f.function_type === 'driver').length,
    rekoOfficers: specialFunctions.filter((f) => f.function_type === 'reko').length,
    magazinStaff: specialFunctions.filter((f) => f.function_type === 'magazin').length,
    mapTilesAvailable,
    printerEnabled: printerStatus?.enabled ?? false,
    printerAgentOnline: printerStatus?.agent_online ?? false,
    onCopyCheckInLink: noop,
    onPrintCheckInLink: noop,
    onCopyRekoLink: noop,
    onPrintRekoLink: noop,
    onCopyAlarmLink: noop,
    onPrintAlarmLink: noop,
    onShowTileSetup: noop,
    onTestPrint: noop,
  })

  let overrides: Record<string, boolean> = {}
  try {
    if (typeof window !== 'undefined') {
      overrides = JSON.parse(localStorage.getItem(checklistOverridesKey(eventId)) || '{}')
    }
  } catch {
    overrides = {}
  }

  const completedCount = tasks.filter((t) => isTaskComplete(t, overrides)).length
  return {
    completed: completedCount,
    total: tasks.length,
    allComplete: tasks.length > 0 && completedCount === tasks.length,
  }
}

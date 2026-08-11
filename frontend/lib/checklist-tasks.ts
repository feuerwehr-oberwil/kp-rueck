import { LucideIcon, Binoculars, MessageCircle, User, Users, Truck, Package, Map, Printer, Copy, LifeBuoy } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { getTileBaseUrl } from '@/lib/env'
import { translateOutsideReact } from '@/lib/i18n-messages'
import { LAGEBLATT_AUTODOWNLOAD_KEY } from '@/components/settings/fallback-settings'
import { isBooleanRecord, readJson } from '@/lib/utils/safe-storage'

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
 * The vehicles nobody is driving yet, in the order they are listed. Shared by the
 * checklist popover and the "Bereitschaft" badge so the two can never disagree
 * about how much of the fleet is still missing a driver.
 */
export function findVehiclesWithoutDriver(
  vehicles: { id: string; name: string }[],
  specialFunctions: { function_type: string; vehicle_id: string | null }[]
): { vehicleId: string; vehicleName: string }[] {
  const driven = new Set(
    specialFunctions.filter((f) => f.function_type === 'driver' && f.vehicle_id).map((f) => f.vehicle_id)
  )
  return vehicles.filter((v) => !driven.has(v.id)).map((v) => ({ vehicleId: v.id, vehicleName: v.name }))
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
  fallbackReady: boolean
  onCopyCheckInLink: () => void
  onPrintCheckInLink: () => void
  onCopyRekoLink: () => void
  onPrintRekoLink: () => void
  onCopyAlarmLink: () => void
  onPrintAlarmLink: () => void
  onShowTileSetup: () => void
  onTestPrint: () => void
  onOpenFallbackSettings: () => void
  /** Opens the Fahrzeuge sheet, where a driver is set per vehicle. */
  onOpenVehicles: () => void
  /** Starts a run through every vehicle that still has no driver. */
  onAssignDrivers: () => void
  /** How many vehicles still have nobody driving them — 0 hides the run button. */
  vehiclesWithoutDriver: number
  /** Opens the Appell — the board's own roll-call, where the count on this row is made. */
  onOpenAttendance: () => void
}): ChecklistTaskState[] {
  const printerAvailable = params.printerEnabled && params.printerAgentOnline

  // A link row prints the QR when a printer is reachable, otherwise copies the link.
  const linkAction = (onCopy: () => void, onPrint: () => void): ChecklistAction =>
    printerAvailable
      ? { label: translateOutsideReact('checklist.actions.printQr'), icon: Printer, variant: 'default', onClick: onPrint }
      : { label: translateOutsideReact('checklist.actions.copyLink'), icon: Copy, variant: 'default', onClick: onCopy }

  return [
    // 1. Send first WhatsApp notification (two-message picker, handled in component).
    // Manual tick only — copying a message must not auto-complete it, so the
    // operator can re-copy as often as needed and check it off when truly sent.
    {
      id: 'send-first-whatsapp',
      title: translateOutsideReact('checklist.tasks.send-first-whatsapp.title'),
      description: translateOutsideReact('checklist.tasks.send-first-whatsapp.description'),
      icon: MessageCircle,
      priority: 'recommended',
      isWhatsApp: true,
      completed: false
    },

    // 2. Check in personnel (Critical) — share link or print QR
    {
      id: 'personnel-checkin',
      title: translateOutsideReact('checklist.tasks.personnel-checkin.title'),
      description: translateOutsideReact('checklist.tasks.personnel-checkin.description'),
      icon: Users,
      priority: 'critical',
      completed: params.checkedInPersonnel >= 3,
      metadata: {
        count: params.checkedInPersonnel,
        details: translateOutsideReact('checklist.tasks.personnel-checkin.details', { count: params.checkedInPersonnel })
      },
      // Two ways in, because there are two situations: hand the crew a link, or tick the
      // names yourself when the phones are not an option.
      actionButtons: [
        linkAction(params.onCopyCheckInLink, params.onPrintCheckInLink),
        {
          label: translateOutsideReact('checklist.actions.openAttendance'),
          icon: Users,
          variant: 'outline',
          onClick: params.onOpenAttendance
        }
      ]
    },

    // 3. Share Reko link — share link or print QR
    {
      id: 'share-reko-link',
      title: translateOutsideReact('checklist.tasks.share-reko-link.title'),
      description: translateOutsideReact('checklist.tasks.share-reko-link.description'),
      icon: Map,
      priority: 'recommended',
      completed: false,
      actionButtons: [linkAction(params.onCopyRekoLink, params.onPrintRekoLink)]
    },

    // 4. Share Alarm link — share link or print QR
    {
      id: 'share-alarm-link',
      title: translateOutsideReact('checklist.tasks.share-alarm-link.title'),
      description: translateOutsideReact('checklist.tasks.share-alarm-link.description'),
      icon: MessageCircle,
      priority: 'recommended',
      completed: false,
      actionButtons: [linkAction(params.onCopyAlarmLink, params.onPrintAlarmLink)]
    },

    // 5. Assign reconnaissance officers — the Reko-Modus on the map is where
    //    a checked-in person is marked as Reko *and* handed their first
    //    addresses, so the row links straight into it rather than describing
    //    where to look.
    {
      id: 'assign-reko',
      title: translateOutsideReact('checklist.tasks.assign-reko.title'),
      description: translateOutsideReact('checklist.tasks.assign-reko.description'),
      icon: Users,
      priority: 'recommended',
      completed: params.rekoOfficers >= 1,
      metadata: {
        count: params.rekoOfficers,
        details: translateOutsideReact('checklist.tasks.assign-reko.details', { count: params.rekoOfficers })
      },
      actionButtons: [
        {
          label: translateOutsideReact('checklist.actions.openRekoMode'),
          icon: Binoculars,
          variant: 'outline',
          href: '/map?mode=reko'
        }
      ]
    },

    // 6. Assign drivers — the row's own promise is "alle Fahrzeuge benötigen einen
    //    Fahrer", so the first button walks every driverless vehicle in one pass
    //    rather than making the operator find each one. The Fahrzeuge sheet stays
    //    alongside it for looking at the fleet rather than working through it.
    {
      id: 'assign-drivers',
      title: translateOutsideReact('checklist.tasks.assign-drivers.title'),
      description: translateOutsideReact('checklist.tasks.assign-drivers.description'),
      icon: Truck,
      priority: 'critical',
      completed: params.driverAssignments >= params.totalVehicles && params.totalVehicles > 0,
      metadata: {
        count: params.driverAssignments,
        total: params.totalVehicles,
        details: translateOutsideReact('checklist.tasks.assign-drivers.details', { count: params.driverAssignments, total: params.totalVehicles })
      },
      actionButtons: [
        ...(params.vehiclesWithoutDriver > 0
          ? [
              {
                label: translateOutsideReact('checklist.actions.assignDrivers'),
                icon: User,
                variant: 'outline' as const,
                onClick: params.onAssignDrivers
              }
            ]
          : []),
        {
          label: translateOutsideReact('checklist.actions.openVehicles'),
          icon: Truck,
          variant: 'outline',
          onClick: params.onOpenVehicles
        }
      ]
    },

    // 7. Assign magazin staff. Deliberately NO action: a Magaziner is marked by
    //    right-clicking a checked-in person in the crew sidebar, which is not a
    //    destination anything can navigate to. A button that opened "somewhere
    //    near it" would be worse than the sentence.
    {
      id: 'assign-magazin',
      title: translateOutsideReact('checklist.tasks.assign-magazin.title'),
      description: translateOutsideReact('checklist.tasks.assign-magazin.description'),
      icon: Package,
      priority: 'optional',
      completed: params.magazinStaff >= 1,
      metadata: {
        details: params.magazinStaff >= 1
          ? translateOutsideReact('checklist.tasks.assign-magazin.detailsAssigned', { count: params.magazinStaff })
          : translateOutsideReact('checklist.tasks.assign-magazin.detailsNotAssigned')
      }
    },

    // 8. Printer reachable — verify each callout (config is one-time, reachability is not)
    {
      id: 'printer-ready',
      title: translateOutsideReact('checklist.tasks.printer-ready.title'),
      description: translateOutsideReact('checklist.tasks.printer-ready.description'),
      icon: Printer,
      priority: 'recommended',
      // Not blocking when the printer is intentionally disabled; otherwise the
      // Pi print-agent must be online (its IP drifts via DHCP — a classic
      // "warum druckt es nicht" failure a rare user only finds at the worst moment).
      completed: !params.printerEnabled || params.printerAgentOnline,
      metadata: {
        details: !params.printerEnabled
          ? translateOutsideReact('checklist.tasks.printer-ready.detailsDisabled')
          : params.printerAgentOnline
            ? translateOutsideReact('checklist.tasks.printer-ready.detailsOnline')
            : translateOutsideReact('checklist.tasks.printer-ready.detailsOffline')
      },
      actionButtons: [
        {
          label: translateOutsideReact('checklist.tasks.printer-ready.testPrint'),
          icon: Printer,
          variant: 'default',
          onClick: params.onTestPrint
        }
      ]
    },

    // 9. Paper fallback armed — a snapshot must exist OUTSIDE the system when it fails
    {
      id: 'fallback-ready',
      title: translateOutsideReact('checklist.tasks.fallback-ready.title'),
      description: translateOutsideReact('checklist.tasks.fallback-ready.description'),
      icon: LifeBuoy,
      priority: 'recommended',
      completed: params.fallbackReady,
      metadata: {
        details: params.fallbackReady
          ? translateOutsideReact('checklist.tasks.fallback-ready.detailsActive')
          : translateOutsideReact('checklist.tasks.fallback-ready.detailsInactive')
      },
      actionButtons: [
        {
          label: translateOutsideReact('checklist.tasks.fallback-ready.setup'),
          icon: LifeBuoy,
          variant: 'outline',
          onClick: params.onOpenFallbackSettings
        }
      ]
    },

    // 10. Configure offline maps (Optional)
    {
      id: 'configure-map-mode',
      title: translateOutsideReact('checklist.tasks.configure-map-mode.title'),
      description: translateOutsideReact('checklist.tasks.configure-map-mode.description'),
      icon: Map,
      priority: 'optional',
      completed: params.mapTilesAvailable,
      metadata: {
        details: params.mapTilesAvailable
          ? translateOutsideReact('checklist.tasks.configure-map-mode.detailsAvailable')
          : translateOutsideReact('checklist.tasks.configure-map-mode.detailsNotSetup')
      },
      actionButtons: [
        {
          label: translateOutsideReact('checklist.tasks.configure-map-mode.mapSetup'),
          icon: Map,
          variant: 'outline',
          onClick: params.onShowTileSetup
        }
      ]
    }
  ]
}

/**
 * The paper fallback counts as armed when either snapshot routine runs:
 * server-side auto thermal print (needs the printer enabled too) or the
 * Lageblatt auto-download on THIS device (localStorage).
 */
export function isFallbackReady(settings: Record<string, string>, printerEnabled: boolean): boolean {
  const autoPrint = printerEnabled && settings['fallback.auto_print_enabled'] === 'true'
  const autoDownload =
    typeof window !== 'undefined' && localStorage.getItem(LAGEBLATT_AUTODOWNLOAD_KEY) === 'true'
  return autoPrint || autoDownload
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
  const [attendance, specialFunctions, vehicles, printerStatus, settings] = await Promise.all([
    apiClient.getEventCheckInList(eventId).catch(() => ({ personnel: [] })),
    apiClient.getEventSpecialFunctions(eventId).catch(() => []),
    apiClient.getVehicles().catch(() => []),
    apiClient.getPrinterStatus().catch(() => null),
    apiClient.getAllSettings().catch(() => ({}) as Record<string, string>),
  ])

  let mapTilesAvailable = false
  try {
    mapTilesAvailable = (await fetch(`${getTileBaseUrl()}/health`)).ok
  } catch {
    mapTilesAvailable = false
  }

  const noop = () => {}
  const tasks = generateChecklistTasks({
    eventId,
    checkedInPersonnel: attendance.personnel.filter((p) => p.checked_in).length,
    totalVehicles: vehicles.length,
    driverAssignments: specialFunctions.filter((f) => f.function_type === 'driver').length,
    rekoOfficers: specialFunctions.filter((f) => f.function_type === 'reko').length,
    magazinStaff: specialFunctions.filter((f) => f.function_type === 'magazin').length,
    mapTilesAvailable,
    printerEnabled: printerStatus?.enabled ?? false,
    printerAgentOnline: printerStatus?.agent_online ?? false,
    fallbackReady: isFallbackReady(settings, printerStatus?.enabled ?? false),
    onCopyCheckInLink: noop,
    onPrintCheckInLink: noop,
    onCopyRekoLink: noop,
    onPrintRekoLink: noop,
    onCopyAlarmLink: noop,
    onPrintAlarmLink: noop,
    onShowTileSetup: noop,
    onTestPrint: noop,
    onOpenFallbackSettings: noop,
    onOpenVehicles: noop,
    onAssignDrivers: noop,
    vehiclesWithoutDriver: findVehiclesWithoutDriver(vehicles, specialFunctions).length,
    onOpenAttendance: noop,
  })

  // Shares the validation used by the checklist component's reader, so a value
  // of the wrong shape can't crash one caller while the other shrugs it off.
  const overrides = readJson(checklistOverridesKey(eventId), isBooleanRecord, {})

  const completedCount = tasks.filter((t) => isTaskComplete(t, overrides)).length
  return {
    completed: completedCount,
    total: tasks.length,
    allComplete: tasks.length > 0 && completedCount === tasks.length,
  }
}

import { LucideIcon, Binoculars, MessageCircle, Users, Truck, Package, Printer, Copy, LifeBuoy } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
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
  /** Which stored WhatsApp template this row copies — the component turns it into
   *  a copy button instead of a plain action. */
  whatsappMessage?: 1 | 2
  /** Who the row's link/QR is for and how many copies to print. Shown as a second
   *  line, because "Link kopieren" does not say who is supposed to hold it. */
  note?: string
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

// --- Station configuration of the checklist itself -------------------------
// Which steps a station runs, and who its slips are for, are not the same
// everywhere: a brigade that never prints an Alarm-Plakat should not stare at a
// row it will never tick, and "1 Ausdruck pro Fahrzeug" is Oberwil's number, not
// everybody's. Both live in settings so an editor changes them without a deploy.
/** JSON array of task ids the station has switched off. */
export const CHECKLIST_HIDDEN_TASKS_KEY = 'checklist.hidden_tasks'
/** JSON object of task id → the station's own note text ("" = use the default). */
export const CHECKLIST_NOTES_KEY = 'checklist.notes'

function readJsonSetting(settings: Record<string, string>, key: string): unknown {
  const raw = settings[key]
  if (!raw || !raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    // A hand-edited setting must never take the checklist down with it — the
    // checklist is what somebody reads while starting a command post.
    return null
  }
}

/** The task ids this station has hidden. */
export function parseHiddenTasks(settings: Record<string, string>): Set<string> {
  const parsed = readJsonSetting(settings, CHECKLIST_HIDDEN_TASKS_KEY)
  return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
}

/** The station's own note per task id. */
export function parseTaskNotes(settings: Record<string, string>): Record<string, string> {
  const parsed = readJsonSetting(settings, CHECKLIST_NOTES_KEY)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

/**
 * The rows this station actually runs: hidden steps dropped, notes overridden.
 *
 * Applied by every caller BEFORE counting, so a hidden row cannot sit in the
 * n/m badge as a step that can never be completed.
 */
export function applyChecklistSettings(
  tasks: ChecklistTaskState[],
  settings: Record<string, string>
): ChecklistTaskState[] {
  const hidden = parseHiddenTasks(settings)
  const notes = parseTaskNotes(settings)
  return tasks
    .filter((task) => !hidden.has(task.id))
    .map((task) => {
      const override = notes[task.id]
      // An empty string means "no note here" — deleting the text must be able to
      // remove the line, not silently fall back to the built-in one.
      return override === undefined ? task : { ...task, note: override.trim() || undefined }
    })
}

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
 * checklist popover and the "Checkliste" badge so the two can never disagree
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
 * Link-sharing rows (check-in, Alarm, Feld) adapt their action: when a thermal
 * printer is reachable they print the QR, otherwise they copy the link.
 * The WhatsApp row is handled specially by the component (two-message picker).
 */
export function generateChecklistTasks(params: {
  eventId: string
  checkedInPersonnel: number
  totalVehicles: number
  driverAssignments: number
  rekoOfficers: number
  magazinStaff: number
  printerEnabled: boolean
  printerAgentOnline: boolean
  fallbackReady: boolean
  onCopyCheckInLink: () => void
  onPrintCheckInLink: () => void
  onCopyAlarmLink: () => void
  onPrintAlarmLink: () => void
  onCopyFeldLink: () => void
  onPrintFeldLink: () => void
  onTestPrint: () => void
  onOpenFallbackSettings: () => void
  /** Opens the Fahrzeuge sheet, where a driver is set per vehicle. */
  onOpenVehicles: () => void
  /** How many vehicles still have nobody driving them — shown as the row's count. */
  vehiclesWithoutDriver: number
  /** Opens the Appell — the board's own roll-call, where the count on this row is made. */
  onOpenAttendance: () => void
  /** Opens the Reko picker — mark checked-in people as Reko without leaving the board. */
  onOpenRekoPicker: () => void
}): ChecklistTaskState[] {
  const printerAvailable = params.printerEnabled && params.printerAgentOnline

  // A link row prints the QR when a printer is reachable, otherwise copies the link.
  const linkAction = (onCopy: () => void, onPrint: () => void): ChecklistAction =>
    printerAvailable
      ? { label: translateOutsideReact('checklist.actions.printQr'), icon: Printer, variant: 'default', onClick: onPrint }
      : { label: translateOutsideReact('checklist.actions.copyLink'), icon: Copy, variant: 'default', onClick: onCopy }

  return [
    // 1a/1b. The two WhatsApp messages, one row each. They are sent at different
    // moments — Standby when the KP goes up, Einrücken when the crew is actually
    // called in — so a single row with a picker could only ever be ticked once.
    // Manual tick only: copying a message must not auto-complete it, so the
    // operator can re-copy as often as needed and check it off when truly sent.
    {
      id: 'send-first-whatsapp',
      title: translateOutsideReact('checklist.tasks.send-first-whatsapp.title'),
      description: translateOutsideReact('checklist.tasks.send-first-whatsapp.description'),
      note: translateOutsideReact('checklist.tasks.send-first-whatsapp.note'),
      icon: MessageCircle,
      priority: 'recommended',
      whatsappMessage: 1,
      completed: false
    },

    {
      id: 'send-second-whatsapp',
      title: translateOutsideReact('checklist.tasks.send-second-whatsapp.title'),
      description: translateOutsideReact('checklist.tasks.send-second-whatsapp.description'),
      note: translateOutsideReact('checklist.tasks.send-second-whatsapp.note'),
      icon: MessageCircle,
      priority: 'recommended',
      whatsappMessage: 2,
      completed: false
    },

    // 2. Check in personnel (Critical) — share link or print QR
    {
      id: 'personnel-checkin',
      title: translateOutsideReact('checklist.tasks.personnel-checkin.title'),
      description: translateOutsideReact('checklist.tasks.personnel-checkin.description'),
      note: translateOutsideReact('checklist.tasks.personnel-checkin.note'),
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

    // 3. Share Alarm link — share link or print QR
    {
      id: 'share-alarm-link',
      title: translateOutsideReact('checklist.tasks.share-alarm-link.title'),
      description: translateOutsideReact('checklist.tasks.share-alarm-link.description'),
      note: translateOutsideReact('checklist.tasks.share-alarm-link.note'),
      icon: MessageCircle,
      priority: 'recommended',
      completed: false,
      actionButtons: [linkAction(params.onCopyAlarmLink, params.onPrintAlarmLink)]
    },

    // 4. Share the Feld link — the one the crews carry out of the door, so it is
    //    the one poster that has to exist BEFORE anybody drives off. It replaced
    //    the paper Fahrzeugrapport: a Schadenplatz-Rapport is filled in on the
    //    phone behind this link, and a crew that left without it has no way to
    //    report anything but the radio.
    //
    //    It absorbed the Reko row, which used to sit above and by the end minted
    //    the *same* link — `/reko-dashboard` is gone and a Reko auftrag opens
    //    from the crew's own page now, so it was one poster described twice.
    //
    //    The printed slip is no longer a credential on its own (plan 26): it
    //    buys the right to be asked for the Feld-Code, which is why the code
    //    card sits directly under this row and belongs on the same poster.
    {
      id: 'share-feld-link',
      title: translateOutsideReact('checklist.tasks.share-feld-link.title'),
      description: translateOutsideReact('checklist.tasks.share-feld-link.description'),
      note: translateOutsideReact('checklist.tasks.share-feld-link.note'),
      icon: Truck,
      priority: 'recommended',
      completed: false,
      actionButtons: [linkAction(params.onCopyFeldLink, params.onPrintFeldLink)]
    },

    // 5. Assign reconnaissance officers — a picker right here, so the step is
    //    done where it is read. The row used to link into the map's Reko-Modus,
    //    which marks people too — but it also does dispatching, and the setup
    //    step is only «wer ist Reko». The Reko-Modus stays reachable from the
    //    map for handing out addresses.
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
          label: translateOutsideReact('checklist.actions.chooseReko'),
          icon: Binoculars,
          variant: 'outline',
          onClick: params.onOpenRekoPicker
        }
      ]
    },

    // 6. Assign drivers — one button, into the Fahrzeuge sheet.
    //
    //    There used to be a second one that walked every driverless vehicle
    //    through the «Fahrer für X» modal in a run. It was dropped: the order was
    //    whatever the fleet query returned, each step named one vehicle with
    //    nothing around it, and an operator four modals deep had no way to see
    //    which of them were still open. The sheet shows the whole fleet with its
    //    drivers at once, which is the same job with the context left in.
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
    }

    // There used to be a 10th row, «Offline-Karten einrichten». It only ever
    // mattered for a locally self-hosted stack with its own tile server, and
    // probing /tiles/health on every open cost more than the row was worth.
  ]
}

/**
 * Every row the checklist can show — id, title and built-in note — for the
 * Settings editor, which has no event and none of the live counts.
 *
 * Built by generating the real list with placeholder state rather than keeping a
 * second hand-written copy: a row added above would otherwise be missing from
 * the place where it can be switched off.
 */
export function listChecklistTasks(): { id: string; title: string; defaultNote?: string }[] {
  const noop = () => {}
  return generateChecklistTasks({
    eventId: '',
    checkedInPersonnel: 0,
    totalVehicles: 0,
    driverAssignments: 0,
    rekoOfficers: 0,
    magazinStaff: 0,
    printerEnabled: false,
    printerAgentOnline: false,
    fallbackReady: false,
    onCopyCheckInLink: noop,
    onPrintCheckInLink: noop,
    onCopyAlarmLink: noop,
    onPrintAlarmLink: noop,
    onCopyFeldLink: noop,
    onPrintFeldLink: noop,
    onTestPrint: noop,
    onOpenFallbackSettings: noop,
    onOpenVehicles: noop,
    vehiclesWithoutDriver: 0,
    onOpenAttendance: noop,
    onOpenRekoPicker: noop,
  }).map((task) => ({ id: task.id, title: task.title, defaultNote: task.note }))
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
 * Effective completion. A row the system can SEE is done (a Reko is marked,
 * every vehicle has its driver, the printer answers) is done — a stored manual
 * un-tick must not outlive the fact. Overrides used to have the unconditional
 * last word, and one stray toggle of the «Reko bestimmen» row (the whole row is
 * the click target) pinned it un-ticked on that device forever: marking a Reko
 * afterwards never tripped the checklist again. Overrides still work both ways
 * on every row whose auto state is false — which includes all manual rows.
 */
export function isTaskComplete(
  task: ChecklistTaskState,
  overrides: Record<string, boolean>
): boolean {
  if (task.completed) return true
  return Object.prototype.hasOwnProperty.call(overrides, task.id) ? overrides[task.id] : false
}

/**
 * Fetch live state and summarise checklist completion using the SAME rules as
 * generateChecklistTasks (single source of truth). Used by the persistent
 * "Checkliste" badge so it stays live even when the popover is closed.
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

  const noop = () => {}
  const tasks = generateChecklistTasks({
    eventId,
    checkedInPersonnel: attendance.personnel.filter((p) => p.checked_in).length,
    totalVehicles: vehicles.length,
    driverAssignments: specialFunctions.filter((f) => f.function_type === 'driver').length,
    rekoOfficers: specialFunctions.filter((f) => f.function_type === 'reko').length,
    magazinStaff: specialFunctions.filter((f) => f.function_type === 'magazin').length,
    printerEnabled: printerStatus?.enabled ?? false,
    printerAgentOnline: printerStatus?.agent_online ?? false,
    fallbackReady: isFallbackReady(settings, printerStatus?.enabled ?? false),
    onCopyCheckInLink: noop,
    onPrintCheckInLink: noop,
    onCopyAlarmLink: noop,
    onPrintAlarmLink: noop,
    onCopyFeldLink: noop,
    onPrintFeldLink: noop,
    onTestPrint: noop,
    onOpenFallbackSettings: noop,
    onOpenVehicles: noop,
    vehiclesWithoutDriver: findVehiclesWithoutDriver(vehicles, specialFunctions).length,
    onOpenAttendance: noop,
    onOpenRekoPicker: noop,
  })

  // The station's own selection of steps — the badge must count what the
  // popover shows, so it is applied here too.
  const visible = applyChecklistSettings(tasks, settings)

  // Shares the validation used by the checklist component's reader, so a value
  // of the wrong shape can't crash one caller while the other shrugs it off.
  const overrides = readJson(checklistOverridesKey(eventId), isBooleanRecord, {})

  const completedCount = visible.filter((t) => isTaskComplete(t, overrides)).length
  return {
    completed: completedCount,
    total: visible.length,
    allComplete: visible.length > 0 && completedCount === visible.length,
  }
}

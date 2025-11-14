import { LucideIcon, MessageCircle, Users, Truck, Camera, Package, Map } from 'lucide-react'

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

/**
 * Generate checklist tasks with current state
 */
export function generateChecklistTasks(params: {
  eventId: string
  checkedInPersonnel: number
  totalVehicles: number
  driverAssignments: number
  rekoOfficers: number
  magazinStaff: number
  mapTilesAvailable: boolean
  firstWhatsAppSent: boolean
  onCopyCheckInLink: () => void
  onShowCheckInQR: () => void
  onAutoAssignDrivers: () => void
  onSendWhatsApp: () => void
  onShowTileSetup: () => void
}): ChecklistTaskState[] {
  return [
    // 1. Send first WhatsApp notification
    {
      id: 'send-first-whatsapp',
      title: 'Erste Info-WhatsApp senden',
      description: 'Mannschaft und Reko-Offiziere über Ereignis informieren',
      icon: MessageCircle,
      priority: 'recommended',
      completed: params.firstWhatsAppSent,
      metadata: {
        details: params.firstWhatsAppSent ? 'WhatsApp gesendet' : 'Noch nicht gesendet'
      },
      actionButtons: [
        {
          label: 'WhatsApp-Nachricht senden',
          icon: MessageCircle,
          variant: 'default',
          onClick: params.onSendWhatsApp
        }
      ]
    },

    // 2. Check in personnel (Critical)
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
      actionButtons: [
        {
          label: 'Check-In Link kopieren',
          icon: MessageCircle,
          variant: 'default',
          onClick: params.onCopyCheckInLink
        },
        {
          label: 'QR-Code anzeigen',
          icon: Camera,
          variant: 'outline',
          onClick: params.onShowCheckInQR
        },
        {
          label: 'Zur Personal-Verwaltung',
          icon: Users,
          variant: 'outline',
          href: '/resources'
        }
      ]
    },

    // 3. Assign drivers (Critical)
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
      },
      actionButtons: [
        {
          label: 'Fahrer zuweisen',
          icon: Truck,
          variant: 'default',
          href: '/resources#drivers'
        },
        {
          label: 'Auto-Zuweisen',
          icon: Camera,
          variant: 'outline',
          onClick: params.onAutoAssignDrivers
        }
      ]
    },

    // 4. Assign reconnaissance officers (Recommended)
    {
      id: 'assign-reko',
      title: 'Reko-Offiziere bestimmen',
      description: 'Mindestens 1 Person für Rekognoszierung',
      icon: Camera,
      priority: 'recommended',
      completed: params.rekoOfficers >= 1,
      metadata: {
        count: params.rekoOfficers,
        details: `${params.rekoOfficers} Reko-Offizier${params.rekoOfficers !== 1 ? 'e' : ''} zugewiesen`
      },
      actionButtons: [
        {
          label: 'Reko-Offizier zuweisen',
          icon: Users,
          variant: 'default',
          href: '/resources#reko'
        }
      ]
    },

    // 5. Assign magazin staff (Optional)
    {
      id: 'assign-magazin',
      title: 'Magazin-Personal zuweisen',
      description: 'Optional: Person für Material-Ausgabe',
      icon: Package,
      priority: 'optional',
      completed: params.magazinStaff >= 1,
      metadata: {
        count: params.magazinStaff,
        details: params.magazinStaff >= 1
          ? `${params.magazinStaff} Person${params.magazinStaff !== 1 ? 'en' : ''} zugewiesen`
          : 'Noch nicht zugewiesen'
      },
      actionButtons: [
        {
          label: 'Magazin-Person zuweisen',
          icon: Users,
          variant: 'outline',
          href: '/resources#magazin'
        }
      ]
    },

    // 6. Configure offline maps (Optional)
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
        },
        {
          label: 'Anleitung',
          icon: Package,
          variant: 'ghost',
          href: '/help#offline-maps'
        }
      ]
    }
  ]
}

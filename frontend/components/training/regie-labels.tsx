'use client'

import { useTranslations } from 'next-intl'
import { ClipboardCheck, Flag, MapPin, Truck, Warehouse, type LucideIcon } from 'lucide-react'

import type { ApiRegieStep, ApiRegieStepKey } from '@/lib/api/types'
import { formatEta } from '@/lib/gps-sim'

/** Icon per field step – keeps a row scannable at a glance. */
export const STEP_ICON: Record<ApiRegieStepKey, LucideIcon> = {
  reko_arrived: MapPin,
  reko_report: ClipboardCheck,
  drive_to_incident: Truck,
  vehicle_on_scene: Truck,
  field_complete: Flag,
  drive_to_magazin: Warehouse,
  rapport: ClipboardCheck,
}

/** The name of a field step («Reko vor Ort», «Einsatz beendet», …), for every Regie list. */
export function useStepLabel(): (key: ApiRegieStepKey) => string {
  const t = useTranslations('training.regie.steps')
  return (key) => {
    switch (key) {
      case 'reko_arrived':
        return t('rekoArrived')
      case 'reko_report':
        return t('rekoReport')
      case 'drive_to_incident':
        return t('driveToIncident')
      case 'vehicle_on_scene':
        return t('vehicleOnScene')
      case 'field_complete':
        return t('fieldComplete')
      case 'drive_to_magazin':
        return t('driveToMagazin')
      case 'rapport':
        return t('rapport')
    }
  }
}

/** «42 % · noch ~2'» for a step whose drive is rolling (the slowest vehicle counts). */
export function DriveProgress({ step }: { step: Pick<ApiRegieStep, 'progress' | 'eta_seconds'> }) {
  const t = useTranslations('training.regie')
  return (
    <span className="tabular-nums">
      {t('driveProgress', { percent: Math.round((step.progress ?? 0) * 100), eta: formatEta(step.eta_seconds ?? 0) })}
    </span>
  )
}

'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  CarTaxiFront,
  ClipboardCheck,
  MapPinCheck,
  Megaphone,
  MessageSquare,
  Square,
  Wrench,
} from 'lucide-react'

import { apiClient, type ApiGpsSimDrive } from '@/lib/api-client'
import type { Operation } from '@/lib/contexts/operations-context'
import { formatEta, liveDrive } from '@/lib/gps-sim'
import { usePolling } from '@/lib/hooks/use-polling'
import { getOperationStatusLabel } from '@/lib/status-labels'
import { countdownText } from '@/lib/training-regie'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { DriveProgress, STEP_ICON, useStepLabel } from '@/components/training/regie-labels'
import { RegieNewSiteForm } from '@/components/training/regie-new-site'
import { useRegie } from '@/components/training/regie-provider'
import { RegieSheet, RegieSheetSection, RegieTile } from '@/components/training/regie-sheet'

/** The simulated drives, polled every 3 s while `enabled` (the sheet is open). Progress
 *  between polls is extrapolated by `liveDrive`. */
function useGpsSimDrives(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ drives: ApiGpsSimDrive[]; fetchedAt: number }>({ drives: [], fetchedAt: 0 })
  const refresh = useCallback(async () => {
    setSnapshot({ drives: await apiClient.getGpsSimulations(), fetchedAt: Date.now() })
  }, [])
  usePolling(refresh, { intervalMs: 3000, enabled })
  return snapshot
}

/** The incident's vehicles: where each one drives (and how far it is), with «Stopp». */
function Vehicles({ op }: { op: Operation }) {
  const t = useTranslations('training')
  // The Regie's clock: a paused drill shows its drives where they stopped.
  const { state, clock, actions, isBusy } = useRegie()
  const { drives, fetchedAt } = useGpsSimDrives(op.vehicles.length > 0)

  return (
    <RegieSheetSection title={t('regie.vehicles')} hint={state?.gps_available ? undefined : t('gpsSim.lockedDemo')}>
      {op.vehicles.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('regie.noVehicles')}</p>
      ) : (
        <ul className="space-y-1.5">
          {op.vehicles.map((vehicle) => {
            const drive = drives.find((d) => d.vehicle_id === vehicle.vehicleId)
            const live = drive ? liveDrive(drive, fetchedAt, clock) : null
            return (
              <li key={vehicle.vehicleId} className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={vehicle.name}>
                    {vehicle.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {drive && live
                      ? t('regie.vehicleDrive', {
                          target: drive.kind === 'magazin' ? t('regie.magazin') : drive.target_label,
                          percent: Math.round(live.progress * 100),
                          eta: formatEta(live.eta),
                        })
                      : t('regie.vehicleIdle')}
                  </span>
                </span>
                {drive && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={isBusy(`drive:${vehicle.vehicleId}`)}
                    onClick={() => void actions.stopDrive(vehicle.vehicleId)}
                  >
                    <Square className="size-3.5" />
                    {t('gpsSim.stopButton')}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </RegieSheetSection>
  )
}

/**
 * The ⋯ sheet of one incident: every Regie action for it. Halten, its field steps «Jetzt»
 * («Einsatz beendet» asks «Kommt der Trupp selbst zurück?»), the injects, «Neuer
 * Schadenplatz …» and its vehicles with their drives. Open while `op` is set.
 */
export function RegieIncidentSheet({ op, onClose }: { op: Operation | null; onClose: () => void }) {
  const t = useTranslations('training')
  const stepLabel = useStepLabel()
  const { state, clock, placeOf, actions, isBusy } = useRegie()
  const regie = op ? state?.incidents.find((i) => i.incident_id === op.id) : undefined

  return (
    <RegieSheet
      open={op !== null}
      onOpenChange={(open) => !open && onClose()}
      title={op ? placeOf(op) : ''}
      description={
        op
          ? t('regie.sheetLine', { status: getOperationStatusLabel(op.status), crew: op.crew.length, vehicles: op.vehicles.length })
          : ''
      }
    >
      {op && (
        <>
          {regie && (
            <div>
              <label htmlFor="regie-hold" className="flex min-h-11 cursor-pointer items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t('regie.hold')}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    {regie.mitspieler ? t('regie.mitspielerHint') : t('regie.holdHint')}
                  </span>
                </span>
                <Switch
                  id="regie-hold"
                  checked={regie.held}
                  disabled={isBusy(`hold:${op.id}`)}
                  onCheckedChange={(held) => void actions.setHeld(op.id, held)}
                />
              </label>
            </div>
          )}

          <RegieSheetSection title={t('regie.fieldSteps')}>
            {!regie || regie.steps.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('regie.noFieldStep')}</p>
            ) : (
              <ul className="space-y-1.5">
                {regie.steps.map((step) => {
                  const Icon = STEP_ICON[step.key]
                  return (
                    <li key={step.key} className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{stepLabel(step.key)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {step.rolling ? (
                            <DriveProgress step={step} />
                          ) : step.due_at ? (
                            countdownText(Date.parse(step.due_at), clock, (key, values) =>
                              key === 'in' ? t('regie.in', values) : t('regie.due'),
                            )
                          ) : (
                            t('regie.noDue')
                          )}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={isBusy(`step:${op.id}`) || (step.key === 'drive_to_magazin' && !state?.magazin_configured)}
                        title={step.key === 'drive_to_magazin' && !state?.magazin_configured ? t('gpsSim.magazinMissing') : undefined}
                        onClick={() => void actions.runStep(op, step.key)}
                      >
                        {t('regie.now')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </RegieSheetSection>

          <RegieSheetSection title={t('regie.injects')}>
            <div className="grid gap-2 sm:grid-cols-2">
              <RegieTile
                icon={AlertTriangle}
                label={t('simulation.injectEscalate')}
                hint={t('simulation.injectEscalateDesc')}
                disabled={isBusy(`inject:${op.id}`)}
                onClick={() => void actions.inject('escalate', op)}
              />
              <RegieTile
                icon={Megaphone}
                label={t('simulation.injectReinforcement')}
                hint={t('simulation.injectReinforcementDesc')}
                disabled={isBusy(`inject:${op.id}`)}
                onClick={() => void actions.inject('reinforcement', op)}
              />
              <RegieTile
                icon={Wrench}
                label={t('simulation.injectBreakdown')}
                hint={t('simulation.injectBreakdownDesc')}
                disabled={isBusy(`inject:${op.id}`) || op.vehicles.length === 0}
                onClick={() => void actions.inject('breakdown', op)}
              />
              <RegieTile
                icon={MapPinCheck}
                label={t('simulation.injectArrived')}
                hint={t('simulation.injectArrivedDesc')}
                disabled={isBusy(`inject:${op.id}`) || op.fieldArrivedAt != null}
                onClick={() => void actions.inject('arrived', op)}
              />
              <RegieTile
                icon={ClipboardCheck}
                label={t('simulation.injectRapport')}
                hint={t('simulation.injectRapportDesc')}
                disabled={isBusy(`inject:${op.id}`)}
                onClick={() => void actions.inject('rapport', op)}
              />
              <RegieTile
                icon={MessageSquare}
                label={t('simulation.injectFieldMessage')}
                hint={t('simulation.injectFieldMessageDesc')}
                disabled={isBusy(`inject:${op.id}`)}
                onClick={() => void actions.inject('fieldMessage', op)}
              />
              <RegieTile
                icon={CarTaxiFront}
                label={op.pickupNeeded ? t('simulation.injectPickupDone') : t('simulation.injectPickupNeeded')}
                hint={op.pickupNeeded ? t('simulation.injectPickupDoneDesc') : t('simulation.injectPickupNeededDesc')}
                disabled={isBusy(`inject:${op.id}`)}
                onClick={() => void actions.inject('pickup', op)}
              />
            </div>
          </RegieSheetSection>

          <RegieSheetSection title={t('regie.newSite')} hint={t('simulation.fieldReportHint')}>
            {op.crew.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('regie.newSiteNoCrew')}</p>
            ) : (
              <RegieNewSiteForm busy={isBusy(`inject:${op.id}`)} onSend={(text) => actions.fieldReport(op, text)} />
            )}
          </RegieSheetSection>

          <Vehicles op={op} />
        </>
      )}
    </RegieSheet>
  )
}

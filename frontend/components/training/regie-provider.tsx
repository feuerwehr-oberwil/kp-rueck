'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { apiClient, ApiError, type ApiIncident } from '@/lib/api-client'
import type { ApiRegieStepKey, ApiRegieTempo } from '@/lib/api/types'
import { useOperations, type Operation } from '@/lib/contexts/operations-context'
import { useAutomatikSettings } from '@/lib/hooks/use-automatik-settings'
import { useCurrentTime } from '@/lib/hooks/use-current-time'
import { useTrainingRegie } from '@/lib/hooks/use-training-regie'
import { regieClock, type RegieInject } from '@/lib/training-regie'
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'
import { PickupQuestionDialog } from '@/components/training/pickup-question-dialog'
import { RegieIncidentSheet } from '@/components/training/regie-incident-sheet'

/** An alarm of «Störung einspielen»: one generated incident, or the Welle (five at once). */
export type RegieAlarm = 'normal' | 'critical' | 'phone' | 'wave'

/** Injects that only the incident's ⋯ offers: they are field reports, not surprises. */
export type RegieFieldInject = RegieInject | 'arrived' | 'rapport'

function useRegieController(eventId: string) {
  const t = useTranslations('training')
  const { operations, formatLocation, refreshOperations } = useOperations()
  const automatikSettings = useAutomatikSettings(true)
  const { state, receivedAt, apply, reload, failed } = useTrainingRegie(eventId, () =>
    toast.info(t('autogen.stoppedAtMax'), { description: t('autogen.stoppedAtMaxDescription') }),
  )
  // One clock for every countdown on the page; the pause stops it (see regieClock).
  const { currentTime } = useCurrentTime(1000)
  // Before the first tick (mount), the instant the state came stands in.
  const now = currentTime?.getTime() ?? receivedAt
  const clock = state ? regieClock(state, now, receivedAt) : now

  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [pickupFor, setPickupFor] = useState<Operation | null>(null)
  const [sheetIncidentId, setSheetIncidentId] = useState<string | null>(null)

  const operationById = useMemo(() => new Map(operations.map((op) => [op.id, op])), [operations])
  const placeOf = useCallback(
    (op: Operation) => (op.locationDisplay ?? formatLocation(op.location)) || op.incidentType,
    [formatLocation],
  )

  /** Runs one write with its busy key; a failure is a toast with the server's sentence.
   *  Resolves whether the write went through. */
  const run = useCallback(
    async (key: string, write: () => Promise<void>): Promise<boolean> => {
      setBusy((current) => new Set(current).add(key))
      try {
        await write()
        return true
      } catch (error: unknown) {
        toast.error(t('common.error'), { description: error instanceof Error ? error.message : t('regie.failed') })
        return false
      } finally {
        setBusy((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }
    },
    [t],
  )

  // An inject changes the board and writes a «Vorhin» line: both refresh, socket or not.
  const settled = useCallback(() => {
    void refreshOperations()
    void reload().catch(() => {})
  }, [refreshOperations, reload])

  const setRegie = (change: { autopilot?: boolean; tempo?: ApiRegieTempo; paused?: boolean }) =>
    run('regie', async () => apply(await apiClient.setRegie(eventId, change)))

  const setAutomatik = (on: boolean) =>
    run('automatik', async () => {
      await apiClient.setAutogen(eventId, on)
      await reload()
      toast.success(on ? t('autogen.started') : t('autogen.stopped'), {
        description: on
          ? t('autogen.startedDescription', { interval: automatikSettings.settings.intervalMin })
          : t('autogen.stoppedDescription'),
      })
    })

  const setHeld = (incidentId: string, held: boolean) =>
    run(`hold:${incidentId}`, async () => apply(await apiClient.setRegieHold(eventId, incidentId, held)))

  /** «Jetzt»: the same server path the Autopilot takes. «Einsatz beendet» first asks
   *  «Kommt der Trupp selbst zurück?» (`pickupNeeded` undefined = not asked yet). */
  const runStep = (op: Operation, key: ApiRegieStepKey, pickupNeeded?: boolean | null) => {
    if (key === 'field_complete' && pickupNeeded === undefined) {
      setPickupFor(op)
      return
    }
    return run(`step:${op.id}`, async () => {
      try {
        apply(await apiClient.runRegieStep(eventId, op.id, key, pickupNeeded))
      } catch (error: unknown) {
        // 409: the step is no longer current (the Autopilot or the board was faster) or cannot
        // run («Magazin-Koordinaten fehlen») – the toast says the server's sentence; the list
        // reloads either way.
        if (ApiError.isConflictError(error)) void reload().catch(() => {})
        throw error
      }
      void refreshOperations()
    })
  }

  const inject = (kind: RegieFieldInject, op: Operation) =>
    run(`inject:${op.id}`, async () => {
      switch (kind) {
        case 'escalate':
          await apiClient.simulateEscalation(eventId, op.id)
          toast.success(t('simulation.escalated'), { description: t('simulation.escalatedDescription') })
          break
        case 'reinforcement': {
          const result = await apiClient.simulateReinforcement(eventId, op.id)
          toast.success(t('simulation.reinforcementRequested'), { description: result.message })
          break
        }
        case 'breakdown': {
          const result = await apiClient.simulateVehicleBreakdown(eventId, op.id)
          toast.success(t('simulation.vehicleBrokenDown', { name: result.vehicle_name }), {
            description: t('simulation.vehicleBrokenDownDescription'),
          })
          break
        }
        case 'pickup': {
          // One item, both halves: a Trupp needs a lift, or has just been picked up.
          const result = await apiClient.simulatePickup(eventId, op.id, { needed: !op.pickupNeeded })
          if (op.pickupNeeded) toast.success(t('simulation.pickupCleared'), { description: result.message })
          else toast.success(t('simulation.pickupNeeded'), { description: t('simulation.pickupNeededDescription') })
          break
        }
        case 'fieldMessage': {
          const result = await apiClient.simulateFieldMessage(eventId, op.id)
          toast.success(t('simulation.fieldMessageSent'), { description: result.message })
          break
        }
        case 'arrived': {
          const result = await apiClient.simulateFieldArrived(eventId, op.id)
          toast.success(t('simulation.arrivedReported'), { description: result.message })
          break
        }
        case 'rapport': {
          const result = await apiClient.simulateRapport(eventId, op.id)
          // The photo count is the one part of the rapport the KP must open the card to see.
          const description =
            result.filed_by && result.photos > 0
              ? t('simulation.rapportFiledByPhotos', { name: result.filed_by, count: result.photos })
              : result.filed_by
                ? t('simulation.rapportFiledBy', { name: result.filed_by })
                : result.message
          toast.success(t('simulation.rapportFiled'), { description })
          break
        }
        case 'fieldReport':
          // Needs text: the «Neuer Schadenplatz» form sends it through `fieldReport`.
          return
      }
      settled()
    })

  /** «Neuer Schadenplatz»: the crew of `op` reports a fresh emergency in free text – through the
   *  real /feld creation path, so it lands in Eingegangen like a crew's Meldung. */
  const fieldReport = (op: Operation, text: string) =>
    run(`inject:${op.id}`, async () => {
      const result = await apiClient.simulateFieldReport(eventId, op.id, text)
      toast.success(t('simulation.fieldReportSent'), { description: result.message })
      settled()
    })

  const toastLine = (incident: ApiIncident) => {
    const location =
      incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity())
    return location ? `${incident.title} @ ${location}` : incident.title
  }

  const alarm = (kind: RegieAlarm) =>
    run('alarm', async () => {
      if (kind === 'wave') {
        // A wave of routine alarms: mostly normal, a rare critical one – five high-prio
        // sounds at once would read as an implausible cluster of major incidents.
        const critical = Array.from({ length: 5 }, () => Math.random() < 0.05).filter(Boolean).length
        const batches = await Promise.all([
          critical < 5 ? apiClient.generateTrainingEmergency(eventId, { category: 'normal', count: 5 - critical }) : [],
          critical > 0 ? apiClient.generateTrainingEmergency(eventId, { category: 'critical', count: critical }) : [],
        ])
        const incidents = batches.flat()
        toast.success(t('controls.toastBurstGenerated', { count: incidents.length }), {
          description: incidents.map((i) => i.title).join(', '),
        })
      } else {
        const [incident] = await apiClient.generateTrainingEmergency(
          eventId,
          kind === 'phone' ? { count: 1, source: 'intake' } : { category: kind, count: 1 },
        )
        const title =
          kind === 'phone'
            ? t('controls.toastPhoneGenerated')
            : kind === 'critical'
              ? t('controls.toastGeneratedCritical')
              : t('controls.toastGenerated')
        toast.success(title, { description: toastLine(incident) })
      }
      settled()
    })

  /** «Gezielt …»: one scenario at a seeded address or a dropped pin. */
  const dispatch = (templateId: string, location: Parameters<typeof apiClient.manualDispatch>[2]) =>
    run('alarm', async () => {
      const incident = await apiClient.manualDispatch(eventId, templateId, location)
      toast.success(t('controls.toastDispatched'), { description: toastLine(incident) })
      settled()
    })

  /** 80 % of the missing Rapporte at once; the missing fifth is the Restliste, on purpose. */
  const rapportsBulk = () =>
    run('alarm', async () => {
      const result = await apiClient.simulateRapportsBulk(eventId)
      if (result.candidates === 0) {
        toast.info(t('simulation.rapportNoCandidates'), { description: t('simulation.rapportNoCandidatesDescription') })
        return
      }
      toast.success(t('simulation.rapportBulkDone', { covered: result.covered, candidates: result.candidates }), {
        description: t('simulation.rapportBulkDoneDescription', { skipped: result.skipped }),
      })
      settled()
    })

  const stopDrive = (vehicleId: string) =>
    run(`drive:${vehicleId}`, async () => {
      await apiClient.stopGpsSimulation(vehicleId)
      void reload().catch(() => {})
    })

  return {
    eventId,
    state,
    failed,
    reload,
    clock,
    now,
    receivedAt,
    operations,
    operationById,
    placeOf,
    automatikSettings,
    isBusy: (key: string) => busy.has(key),
    openIncident: setSheetIncidentId,
    sheetIncidentId,
    pickupFor,
    closePickup: () => setPickupFor(null),
    actions: { setRegie, setAutomatik, setHeld, runStep, inject, fieldReport, alarm, dispatch, rapportsBulk, stopDrive },
  }
}

export type RegieController = ReturnType<typeof useRegieController>

const RegieContext = createContext<RegieController | null>(null)

/** The Regie page's state and actions, for every part of the page under `RegieProvider`. */
export function useRegie(): RegieController {
  const regie = useContext(RegieContext)
  if (!regie) throw new Error('useRegie() outside <RegieProvider>')
  return regie
}

/**
 * Wraps the Übungs-Steuerung of the Übung `eventId`: loads the Regie state (live via the
 * socket), ticks the page's one clock, and owns the two things every part can open – the
 * incident's ⋯ sheet and the «Kommt der Trupp selbst zurück?» question.
 */
export function RegieProvider({ eventId, children }: { eventId: string; children: ReactNode }) {
  const regie = useRegieController(eventId)
  const sheetOp = regie.sheetIncidentId ? regie.operationById.get(regie.sheetIncidentId) : undefined
  return (
    <RegieContext.Provider value={regie}>
      {children}
      <RegieIncidentSheet op={sheetOp ?? null} onClose={() => regie.openIncident(null)} />
      <PickupQuestionDialog
        op={regie.pickupFor}
        place={regie.pickupFor ? regie.placeOf(regie.pickupFor) : ''}
        onClose={regie.closePickup}
        onAnswer={(op, pickupNeeded) => {
          regie.closePickup()
          void regie.actions.runStep(op, 'field_complete', pickupNeeded)
        }}
      />
    </RegieContext.Provider>
  )
}

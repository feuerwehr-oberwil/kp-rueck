'use client'

/**
 * The Restliste on the events page (plan 25, §6 / V-8).
 *
 * Three counts — Schadenplätze ohne Rapport, Geräte noch vor Ort, Trupps die auf
 * Abholung warten — each clickable through to the incidents behind it. This is
 * where somebody at 02:00 finds the gaps, because nobody clicks twenty-three
 * cards individually. It is the operational counterpart of deciding there is no
 * acceptance step (decision 10): nothing is enforced, so the misses have to be
 * *visible* in one place.
 *
 * The material half is additionally printable as the **Abholliste**
 * (decision 25): address · unit · since when, the sheet somebody takes along the
 * next morning. It stays separate from the Trupp-Abholung flag on purpose — a
 * pump running in a cellar and three people standing in the rain are two
 * different days' problems.
 *
 * Renders **nothing at all** when there is nothing open. A gap-finder that says
 * "0 von 0" on every fresh Ereignis is noise on a page that is mostly a list.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CarTaxiFront, ChevronDown, ChevronRight, FileWarning, Loader2, Package, Printer } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { PickupBadge } from '@/components/kanban/pickup-badge'
import { apiClient, type ApiEventRestliste, type ApiRestlisteIncident, type ApiRestlisteUnit } from '@/lib/api-client'
import { usePrintJobToast } from '@/lib/hooks/use-print-job-toast'
import { getActiveLocale } from '@/lib/i18n-messages'

type Section = 'rapport' | 'material' | 'pickup'

interface EventRestlisteProps {
  eventId: string
  /** Selecting the event and navigating is the page's job, not this card's. */
  onOpenIncident: (incidentId: string) => void
  /** No printer configured, no print button. The endpoint refuses the job with
   *  «Printer is not enabled», so offering it is offering a guaranteed error —
   *  the same rule the board's other print buttons already follow. Fetched once
   *  on the page rather than per event card. */
  printerEnabled?: boolean
}

function formatSince(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(getActiveLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function EventRestliste({ eventId, onOpenIncident, printerEnabled = false }: EventRestlisteProps) {
  const t = useTranslations('events.restliste')
  const tPrint = useTranslations('print.toasts')
  const trackPrint = usePrintJobToast()

  const [data, setData] = useState<ApiEventRestliste | null>(null)
  const [open, setOpen] = useState<Section | null>(null)
  const [printing, setPrinting] = useState(false)

  const reload = useCallback(async () => {
    try {
      setData(await apiClient.getEventRestliste(eventId))
    } catch (error) {
      // Silent: the Restliste is an extra on a card that has to render
      // regardless. An event list that fails to load because one roll-up
      // query did is worse than a missing badge.
      console.error('Failed to load Restliste:', error)
    }
  }, [eventId])

  useEffect(() => {
    void reload()
  }, [reload])

  const handlePrintAbholliste = useCallback(async () => {
    setPrinting(true)
    try {
      const job = await apiClient.queueAbhollistePrint(eventId)
      trackPrint(job.id, {
        sentTitle: t('abhollisteQueued'),
        sentDescription: t('abhollisteQueuedDescription'),
        subject: tPrint('subjectAbholliste'),
      })
    } catch (error) {
      console.error('Failed to queue Abholliste:', error)
      // Say WHY. «Konnte nicht gedruckt werden» alone sends the operator looking
      // at the printer when the answer is usually a setting or an agent that is
      // not running.
      toast.error(t('abhollisteFailed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setPrinting(false)
    }
  }, [eventId, t, tPrint, trackPrint])

  if (!data) return null

  const { missing_rapport: missing, material_on_site: material, open_pickups: pickups } = data
  if (missing.length === 0 && material.length === 0 && pickups.length === 0) return null

  const toggle = (section: Section) => setOpen(current => (current === section ? null : section))

  const incidentRow = (row: ApiRestlisteIncident, extra?: string) => (
    <button
      key={row.incident_id}
      type="button"
      onClick={() => onOpenIncident(row.incident_id)}
      className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted/60"
    >
      <span className="truncate font-medium text-foreground">{row.location_address || row.title}</span>
      {extra && <span className="ml-auto shrink-0 text-muted-foreground">{extra}</span>}
    </button>
  )

  const unitRow = (row: ApiRestlisteUnit) => (
    // An untracked entry has no assignment id to key on (§18.35): it is a name
    // from "Weiteres gebrauchtes Material", not a unit the board dispatched.
    // It counts and it is fetched all the same — something is standing at that
    // address either way — but it is marked, because nobody can release it and
    // "seit" is when the rapport was filed rather than when it went out.
    <button
      key={row.assignment_id ?? `${row.incident_id}-${row.name}`}
      type="button"
      onClick={() => onOpenIncident(row.incident_id)}
      className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted/60"
    >
      <span className="truncate font-medium text-foreground">{row.name}</span>
      {!row.tracked && <span className="shrink-0 text-muted-foreground">{t('untracked')}</span>}
      <span className="truncate text-muted-foreground">{row.location_address || row.incident_title}</span>
      {row.since && <span className="ml-auto shrink-0 text-muted-foreground">{formatSince(row.since)}</span>}
    </button>
  )

  return (
    <div className="mt-3 space-y-1 rounded-lg border border-border/60 bg-muted/20 p-2">
      {missing.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => toggle('rapport')}
            aria-expanded={open === 'rapport'}
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted/60"
          >
            {open === 'rapport' ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <FileWarning className="size-3.5 text-warning" />
            <span>{t('missingRapport', { count: missing.length, total: data.incident_total })}</span>
          </button>
          {open === 'rapport' && (
            <div className="ml-4 space-y-0.5 border-l border-border/60 pl-2">
              {missing.map(row =>
                incidentRow(row, row.rapport_state === 'draft' ? t('stateDraft') : undefined),
              )}
            </div>
          )}
        </div>
      )}

      {material.length > 0 && (
        <div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggle('material')}
              aria-expanded={open === 'material'}
              className="flex flex-1 items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted/60"
            >
              {open === 'material' ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              <Package className="size-3.5 text-muted-foreground" />
              <span>{t('materialOnSite', { count: material.length })}</span>
            </button>
            {/* The sheet that goes along the next morning (decision 25). */}
            {printerEnabled && (
              <Button
                variant="ghost"
                size="xs"
                onClick={handlePrintAbholliste}
                disabled={printing}
                title={t('printAbholliste')}
                aria-label={t('printAbholliste')}
              >
                {printing ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />}
              </Button>
            )}
          </div>
          {open === 'material' && (
            <div className="ml-4 space-y-0.5 border-l border-border/60 pl-2">{material.map(unitRow)}</div>
          )}
        </div>
      )}

      {pickups.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => toggle('pickup')}
            aria-expanded={open === 'pickup'}
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted/60"
          >
            {open === 'pickup' ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <CarTaxiFront className="size-3.5 text-amber-600 dark:text-amber-400" />
            <span>{t('openPickups', { count: pickups.length })}</span>
          </button>
          {open === 'pickup' && (
            <div className="ml-4 space-y-0.5 border-l border-border/60 pl-2">
              {/* The chip is the "erledigt" control here too (§18.9). The
                  Restliste is where somebody works the open pickups off one by
                  one, so it is the surface that most needs to tick them off
                  without opening each card. */}
              {pickups.map(row => (
                <div key={row.incident_id} className="flex items-center gap-1">
                  <div className="min-w-0 flex-1">{incidentRow(row, formatSince(row.since))}</div>
                  <PickupBadge
                    requestedAt={row.since ? new Date(row.since) : null}
                    variant="compact"
                    incidentId={row.incident_id}
                    onCleared={reload}
                    className="shrink-0"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

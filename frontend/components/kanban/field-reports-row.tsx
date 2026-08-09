'use client'

/**
 * "Feldmeldungen" — the KP twin of the `/feld` field actions (plan 25,
 * decision 28 and §6.1).
 *
 * KP parity is a hard requirement, not a convenience. The normal case is a
 * radio message: the crew has no signal, no phone or no hands, and dictates. A
 * field surface whose data could only arrive through that surface would make
 * the KP a spectator to its own board — and `field_complete_reported_at` was
 * exactly that until this row existed, a column the frontend rendered and only
 * the training simulator could write.
 *
 * Three toggles, each with its timestamp and an editable time, each saying who
 * reported it. **Provenance is never faked**: a KP write leaves the personnel
 * columns NULL and the audit-log entry carries the operator, so "im KP erfasst"
 * is a real state and not a guess dressed up as a crew report.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CarTaxiFront, Flag, Loader2, MapPin } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { apiClient } from '@/lib/api-client'
import type { ApiFieldReportUpdate } from '@/lib/api/types'
import { useOperations, type Operation } from '@/lib/contexts/operations-context'
import { usePersonnel } from '@/lib/contexts/personnel-context'
import { getActiveLocale } from '@/lib/i18n-messages'
import { applyTimeEdit, toTimeInput } from '@/lib/field-time'
import { formatPickupWaiting } from '@/lib/pickup'

interface FieldReportsRowProps {
  operation: Operation
  canEdit?: boolean
}

type Row = 'arrived' | 'complete' | 'pickup'

export function FieldReportsRow({ operation, canEdit = true }: FieldReportsRowProps) {
  const t = useTranslations('feld.kp')
  const { refreshOperations } = useOperations()
  const { personnel } = usePersonnel()
  const [saving, setSaving] = useState<Row | null>(null)
  const [note, setNote] = useState(operation.pickupNote ?? '')

  const nameById = useMemo(() => new Map(personnel.map(p => [p.id, p.name])), [personnel])

  const save = useCallback(
    async (row: Row, update: ApiFieldReportUpdate) => {
      setSaving(row)
      try {
        await apiClient.setIncidentFieldReport(operation.id, update)
        await refreshOperations()
      } catch (error) {
        console.error('Failed to save field report:', error)
        toast.error(t('saveFailed'))
      } finally {
        setSaving(null)
      }
    },
    [operation.id, refreshOperations, t],
  )

  /**
   * "vom Feld, Muster Hans, 23:14" versus "im KP erfasst, 23:14".
   *
   * `personnelId === null` with a timestamp present IS the KP case — that is
   * the whole provenance rule, read straight off the absence of the FK.
   */
  const provenance = (at: Date | null | undefined, personnelId: string | null | undefined): string | null => {
    if (!at) return null
    const time = at.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
    if (!personnelId) return t('fromKp', { time })
    return t('fromField', { name: nameById.get(personnelId) ?? t('unknownPerson'), time })
  }

  const rows: Array<{
    key: Row
    icon: React.ReactNode
    label: string
    at: Date | null | undefined
    on: boolean
    by: string | null | undefined
    onToggle: (checked: boolean) => void
    onTimeChange: (time: string) => void
  }> = [
    {
      key: 'arrived',
      icon: <MapPin className="h-4 w-4 text-muted-foreground" />,
      label: t('arrived'),
      at: operation.fieldArrivedAt,
      on: Boolean(operation.fieldArrivedAt),
      by: operation.fieldArrivedBy,
      onToggle: checked => save('arrived', { arrived_at: checked ? new Date().toISOString() : null }),
      onTimeChange: time => {
        const next = applyTimeEdit(operation.fieldArrivedAt, time)
        if (next) save('arrived', { arrived_at: next.toISOString() })
      },
    },
    {
      key: 'complete',
      icon: <Flag className="h-4 w-4 text-muted-foreground" />,
      label: t('complete'),
      at: operation.fieldCompleteReportedAt,
      on: Boolean(operation.fieldCompleteReportedAt),
      by: operation.fieldCompleteReportedBy,
      onToggle: checked =>
        save('complete', { field_complete_reported_at: checked ? new Date().toISOString() : null }),
      onTimeChange: time => {
        const next = applyTimeEdit(operation.fieldCompleteReportedAt, time)
        if (next) save('complete', { field_complete_reported_at: next.toISOString() })
      },
    },
    {
      key: 'pickup',
      icon: <CarTaxiFront className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
      label: t('pickup'),
      at: operation.pickupRequestedAt,
      on: Boolean(operation.pickupNeeded),
      by: operation.pickupRequestedBy,
      onToggle: checked => save('pickup', { pickup_needed: checked, pickup_note: checked ? note || null : null }),
      onTimeChange: time => {
        const next = applyTimeEdit(operation.pickupRequestedAt, time)
        if (next) save('pickup', { pickup_needed: true, pickup_note: note || null, pickup_requested_at: next.toISOString() })
      },
    },
  ]

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div>
        <Label className="text-sm font-semibold">{t('title')}</Label>
        {/* Says out loud that this is the radio-message path, so nobody looks
            for a field device that does not exist. */}
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>

      <div className="space-y-2.5">
        {rows.map(row => {
          const line = provenance(row.at, row.by)
          return (
            <div key={row.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {row.icon}
                  <div className="min-w-0">
                    <span className="text-sm">{row.label}</span>
                    {line && <p className="text-xs text-muted-foreground truncate">{line}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {row.on && (
                    <Input
                      type="time"
                      aria-label={t('timeLabel', { what: row.label })}
                      value={toTimeInput(row.at)}
                      disabled={!canEdit || saving === row.key}
                      onChange={e => row.onTimeChange(e.target.value)}
                      className="h-8 w-[7.5rem] text-xs"
                    />
                  )}
                  {saving === row.key ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      aria-label={row.label}
                      checked={row.on}
                      disabled={!canEdit}
                      onCheckedChange={row.onToggle}
                    />
                  )}
                </div>
              </div>

              {row.key === 'pickup' && row.on && (
                <div className="space-y-1.5 pl-6">
                  <Input
                    placeholder={t('pickupNotePlaceholder')}
                    value={note}
                    disabled={!canEdit}
                    onChange={e => setNote(e.target.value)}
                    onBlur={() => {
                      if ((note || '') !== (operation.pickupNote ?? '')) {
                        save('pickup', { pickup_needed: true, pickup_note: note || null })
                      }
                    }}
                    className="text-sm"
                  />
                  {operation.pickupRequestedAt && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {t('waiting', { duration: formatPickupWaiting(operation.pickupRequestedAt) })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle, ChevronDown, Lock, Square, Users } from 'lucide-react'

import { apiClient, ApiError } from '@/lib/api-client'
import { useCurrentTime } from '@/lib/hooks/use-current-time'
import { prepareOpenByDefault } from '@/lib/training-regie'
import { cn } from '@/lib/utils'
import { SettingGroup, SettingRow } from '@/components/settings/setting-row'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ShellLoader } from '@/components/ui/shell-loader'
import { useRegie } from '@/components/training/regie-provider'

/**
 * Personal einchecken: random available people check into the Übung – at once, or trickled
 * over minutes the way an Aufgebot really arrives. A trickle can be stopped: «Stoppen» shows
 * from its start until its window ends, and after a 409 («läuft bereits») – the backend knows
 * about a trickle the page may not.
 */
function Checkin() {
  const t = useTranslations('training.checkin')
  const { eventId } = useRegie()
  const [busy, setBusy] = useState(false)
  const [count, setCount] = useState(10)
  // 0 = sofort; >0 = check-ins trickle in over this many minutes.
  const [minutes, setMinutes] = useState(0)
  // Until when a trickle runs (ms), as far as this page knows; null = none known.
  const [trickleUntil, setTrickleUntil] = useState<number | null>(null)
  const [stopping, setStopping] = useState(false)
  // A coarse clock hides «Stoppen» once the trickle's window has passed.
  const { currentTime } = useCurrentTime(5000)
  const trickling = trickleUntil !== null && currentTime !== null && currentTime.getTime() < trickleUntil

  const checkin = async () => {
    setBusy(true)
    try {
      const result = await apiClient.simulateCheckin(eventId, count, minutes)
      const scheduled = result.scheduled?.length ?? 0
      if (scheduled > 0) {
        setTrickleUntil(Date.now() + (result.trickle_minutes ?? minutes) * 60_000)
        toast.success(t('scheduled', { count: scheduled }), {
          description: t('scheduledDescription', { minutes: result.trickle_minutes ?? minutes }),
        })
      } else if (result.checked_in.length === 0) {
        toast.info(t('noMorePersons'), { description: t('noMorePersonsDescription') })
      }
    } catch (error: unknown) {
      // «läuft bereits»: offer the stop for a trickle this page did not start.
      if (ApiError.isConflictError(error)) setTrickleUntil(Date.now() + 30 * 60_000)
      toast.error(t('failed'), { description: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setStopping(true)
    try {
      const { stopped } = await apiClient.stopSimulatedCheckin(eventId)
      setTrickleUntil(null)
      if (stopped > 0) toast.success(t('stopped', { count: stopped }))
      else toast.info(t('stoppedNone'))
    } catch (error: unknown) {
      toast.error(t('stopFailed'), { description: error instanceof Error ? error.message : undefined })
    } finally {
      setStopping(false)
    }
  }

  return (
    <SettingGroup title={t('title')} hint={t('description')}>
      <div className="space-y-2">
        {/* Phone: Anzahl + Tempo on one line, the button full width under them. From md up, one row. */}
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 md:flex">
          <Input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            className="w-full md:w-20"
            aria-label={t('countAria')}
          />
          <Select value={String(minutes)} onValueChange={(v) => setMinutes(parseInt(v))}>
            <SelectTrigger className="w-full md:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('immediately')}</SelectItem>
              <SelectItem value="5">{t('overMinutes', { count: 5 })}</SelectItem>
              <SelectItem value="10">{t('overMinutes', { count: 10 })}</SelectItem>
              <SelectItem value="15">{t('overMinutes', { count: 15 })}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => void checkin()} disabled={busy} variant="outline" className="col-span-2 md:flex-1">
            {busy ? <ShellLoader className="size-3.5" /> : <Users className="size-3.5" />}
            {busy ? t('checkingIn') : t('checkin')}
          </Button>
        </div>
        {trickling && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{t('running')}</span>
            <Button onClick={() => void stop()} disabled={stopping} variant="outline" size="sm" className="shrink-0">
              {stopping ? <ShellLoader className="size-3.5" /> : <Square className="size-3.5" />}
              {t('stop')}
            </Button>
          </div>
        )}
      </div>
    </SettingGroup>
  )
}

/** The Automatik's two numbers; committed on blur, clamped by the settings hook. */
function AutomatikSettings() {
  const t = useTranslations('training.autogen')
  const { automatikSettings } = useRegie()
  const { settings, loaded, save } = automatikSettings
  // The field's text while typing; the setting itself changes on blur.
  const [draft, setDraft] = useState<{ intervalMin?: string; max?: string }>({})

  const commit = async (field: 'intervalMin' | 'max', raw: string, fallback: number) => {
    setDraft((current) => ({ ...current, [field]: undefined }))
    if (!(await save(field, parseFloat(raw) || fallback))) toast.error(t('saveFailed'))
  }

  return (
    <SettingGroup title={t('title')} hint={t('hint')}>
      <SettingRow label={t('intervalLabel')} htmlFor="regie-automatik-interval">
        <Input
          id="regie-automatik-interval"
          type="number"
          min={1}
          max={60}
          className="w-24"
          disabled={!loaded}
          value={draft.intervalMin ?? String(settings.intervalMin)}
          onChange={(e) => setDraft((current) => ({ ...current, intervalMin: e.target.value }))}
          onBlur={(e) => void commit('intervalMin', e.target.value, settings.intervalMin)}
        />
      </SettingRow>
      <SettingRow label={t('maxLabel')} htmlFor="regie-automatik-max">
        <Input
          id="regie-automatik-max"
          type="number"
          min={1}
          max={200}
          className="w-24"
          disabled={!loaded}
          value={draft.max ?? String(settings.max)}
          onChange={(e) => setDraft((current) => ({ ...current, max: e.target.value }))}
          onBlur={(e) => void commit('max', e.target.value, settings.max)}
        />
      </SettingRow>
    </SettingGroup>
  )
}

/**
 * «Vorbereiten», at the end of the page: Personal einchecken, the Automatik's interval and
 * maximum, and what is missing for the drives. Open for a fresh Übung, folded once the
 * Autopilot or the Automatik runs (`prepareOpenByDefault`) – until the trainer opens or folds
 * it by hand, which then holds.
 */
export function RegiePrepare() {
  const t = useTranslations('training')
  const { state } = useRegie()
  const [manual, setManual] = useState<boolean | null>(null)
  if (!state) return null
  const open = manual ?? prepareOpenByDefault(state)

  return (
    <Collapsible open={open} onOpenChange={setManual}>
      <Card className="gap-0 py-0">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-h-14 w-full items-center gap-2 px-4 text-left sm:px-6">
            <span className="flex-1 font-semibold">{t('regie.prepare')}</span>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 px-4 pb-5 sm:px-6">
            {!state.magazin_configured && (
              <p className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-warning-foreground">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  {t('gpsSim.magazinMissing')}{' '}
                  <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                    {t('gpsSim.magazinMissingLink')}
                  </Link>
                </span>
              </p>
            )}
            {!state.gps_available && (
              <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5 shrink-0" />
                {t('gpsSim.lockedDemo')}
              </p>
            )}
            <Checkin />
            <AutomatikSettings />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}

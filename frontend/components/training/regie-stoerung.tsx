'use client'

import { useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  CarTaxiFront,
  ClipboardCheck,
  Droplet,
  Flame,
  MapPin,
  Megaphone,
  MessageSquare,
  Phone,
  Target,
  Waves,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { apiClient, type ApiEmergencyTemplate, type ApiTrainingLocation } from '@/lib/api-client'
import type { Operation } from '@/lib/contexts/operations-context'
import { injectCandidates, pickInjectTarget, type RegieInject } from '@/lib/training-regie'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SearchEmptyState } from '@/components/ui/empty-state'
import { FormMessage } from '@/components/ui/form-message'
import { SearchInput } from '@/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingStatus } from '@/components/ui/shell-loader'
import { RegieNewSiteForm } from '@/components/training/regie-new-site'
import { useRegie } from '@/components/training/regie-provider'
import { RegieSheet, RegieSheetSection, RegieTile } from '@/components/training/regie-sheet'

// MapLibre needs a browser, and stays out of this page's chunk until the pin is asked for.
const MapPickerModal = dynamic(
  () => import('@/components/location/map-picker-modal').then((mod) => mod.MapPickerModal),
  { ssr: false },
)

const RANDOM = 'random'
/** How many hits a search list shows: the search narrows, it does not scroll. */
const HITS = 6

type View = 'menu' | 'targeted' | 'newSite'
type Pin = { latitude: number; longitude: number; address: string }
/** What «Gezielt …» picks from: the active scenarios (critical first) and seeded addresses. */
type Pools = { templates: ApiEmergencyTemplate[]; locations: ApiTrainingLocation[] }

/** Loads the two pools for «Gezielt …», sorted the way the lists read. */
async function loadPools(): Promise<Pools> {
  const [templates, locations] = await Promise.all([apiClient.getEmergencyTemplates(), apiClient.getTrainingLocations()])
  return {
    templates: templates
      .filter((x) => x.is_active)
      .sort((a, b) =>
        a.category !== b.category ? (a.category === 'critical' ? -1 : 1) : a.title_pattern.localeCompare(b.title_pattern, 'de'),
      ),
    locations: locations
      .filter((x) => x.is_active)
      .sort((a, b) => `${a.street} ${a.house_number}`.localeCompare(`${b.street} ${b.house_number}`, 'de')),
  }
}

const matches = (text: string, query: string) => text.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de'))

/** One pickable row of a search list; chosen = the selection wash. */
function Hit({ chosen, onPick, children }: { chosen: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <Button
      variant={chosen ? 'selected' : 'outline'}
      aria-pressed={chosen}
      onClick={onPick}
      className="h-auto w-full min-w-0 justify-start py-2 text-left whitespace-normal"
    >
      <span className="flex min-w-0 items-center gap-2 break-words">{children}</span>
    </Button>
  )
}

/**
 * «Gezielt …»: one scenario at one place. Both lists are searched (83 scenarios do not fit a
 * select on a phone); the place is a seeded address or a pin dropped on the map, the pin wins.
 */
function TargetedAlarm({ pools, onDone }: { pools: Pools | 'failed' | null; onDone: () => void }) {
  const t = useTranslations('training')
  const { actions, isBusy } = useRegie()
  const [scenarioQuery, setScenarioQuery] = useState('')
  const [placeQuery, setPlaceQuery] = useState('')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [locationId, setLocationId] = useState<string | null>(null)
  const [pin, setPin] = useState<Pin | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const loaded = pools === 'failed' ? null : pools

  const scenarioHits = useMemo(
    () => (loaded?.templates ?? []).filter((x) => matches(x.title_pattern, scenarioQuery)).slice(0, HITS),
    [loaded, scenarioQuery],
  )
  const placeHits = useMemo(
    () => (loaded?.locations ?? []).filter((x) => matches(`${x.street} ${x.house_number} ${x.city}`, placeQuery)).slice(0, HITS),
    [loaded, placeQuery],
  )
  const chosenTemplate = loaded?.templates.find((x) => x.id === templateId)
  const chosenLocation = loaded?.locations.find((x) => x.id === locationId)
  const ready = !!templateId && (!!pin || !!locationId)

  const fire = async () => {
    if (!templateId) return
    const location = pin
      ? ({ kind: 'pin', ...pin } as const)
      : locationId
        ? ({ kind: 'seeded', locationId } as const)
        : null
    if (!location) return
    if (await actions.dispatch(templateId, location)) onDone()
  }

  if (pools === 'failed') return <FormMessage tone="advice">{t('regie.poolsFailed')}</FormMessage>
  if (!loaded) return <LoadingStatus size="inline">{t('page.loading')}</LoadingStatus>

  return (
    <div className="space-y-5">
      <RegieSheetSection title={t('regie.scenario')}>
        <SearchInput
          value={scenarioQuery}
          onValueChange={setScenarioQuery}
          placeholder={t('regie.scenarioSearch')}
          aria-label={t('regie.scenarioSearch')}
        />
        <div className="space-y-1.5">
          {/* The chosen one stays in view while the search moves on. */}
          {chosenTemplate && !scenarioHits.includes(chosenTemplate) && (
            <Hit chosen onPick={() => setTemplateId(null)}>
              {chosenTemplate.title_pattern}
            </Hit>
          )}
          {scenarioHits.map((x) => (
            <Hit key={x.id} chosen={x.id === templateId} onPick={() => setTemplateId(x.id === templateId ? null : x.id)}>
              {x.category === 'critical' ? (
                <Flame className="size-3.5 shrink-0 text-destructive" />
              ) : (
                <Droplet className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              {x.title_pattern}
            </Hit>
          ))}
          {scenarioHits.length === 0 && scenarioQuery.trim() && (
            <SearchEmptyState query={scenarioQuery} onClear={() => setScenarioQuery('')} />
          )}
        </div>
      </RegieSheetSection>

      <RegieSheetSection title={t('regie.place')}>
        {pin ? (
          <div className="flex min-h-11 items-center gap-2 rounded-md border border-sel-edge bg-sel-wash px-3 text-sm text-sel-foreground">
            <MapPin className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={pin.address}>
              {pin.address}
            </span>
            <Button variant="ghost" size="icon" onClick={() => setPin(null)} aria-label={t('controls.removePin')}>
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <SearchInput
                value={placeQuery}
                onValueChange={setPlaceQuery}
                placeholder={t('regie.placeSearch')}
                aria-label={t('regie.placeSearch')}
                containerClassName="min-w-0 flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setPickerOpen(true)}
                aria-label={t('controls.setPin')}
                title={t('controls.setPin')}
              >
                <MapPin className="size-4" />
              </Button>
            </div>
            <div className="space-y-1.5">
              {chosenLocation && !placeHits.includes(chosenLocation) && (
                <Hit chosen onPick={() => setLocationId(null)}>
                  {chosenLocation.street} {chosenLocation.house_number}
                </Hit>
              )}
              {placeHits.map((x) => (
                <Hit key={x.id} chosen={x.id === locationId} onPick={() => setLocationId(x.id === locationId ? null : x.id)}>
                  {x.street} {x.house_number}
                </Hit>
              ))}
              {placeHits.length === 0 && placeQuery.trim() && (
                <SearchEmptyState query={placeQuery} onClear={() => setPlaceQuery('')} />
              )}
            </div>
          </>
        )}
      </RegieSheetSection>

      <div className="space-y-2">
        <Button className="w-full" disabled={!ready || isBusy('alarm')} onClick={() => void fire()}>
          <Target className="size-4" />
          {t('controls.dispatch')}
        </Button>
        {!ready && <FormMessage tone="advice">{t('controls.dispatchNeeds')}</FormMessage>}
      </div>

      <MapPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onLocationSelect={(latitude, longitude, address) =>
          // Without a Nominatim answer the coordinates stand in for the address.
          setPin({ latitude, longitude, address: address ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` })
        }
      />
    </div>
  )
}

/**
 * «Störung einspielen»: the one door for everything the trainer throws at the KP – alarms
 * (Normal, Kritisch, Telefon, Welle, «Gezielt …») and injects into the field. An inject hits
 * the chosen incident, or with «zufällig» a fitting open one (`pickInjectTarget`). The
 * button is the page's loudest thing: in the footer above the bottom nav on the phone, in the
 * left column on a desk (`className`).
 */
export function RegieStoerung({ className }: { className?: string }) {
  const t = useTranslations('training')
  const { state, operations, placeOf, actions, isBusy } = useRegie()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('menu')
  const [targetId, setTargetId] = useState(RANDOM)
  const [pools, setPools] = useState<Pools | 'failed' | null>(null)
  // «Neuer Schadenplatz» with «zufällig»: drawn once when the view opens, not on every tick.
  const [newSiteOp, setNewSiteOp] = useState<Operation | null>(null)

  const openOps = useMemo(() => operations.filter((op) => op.status !== 'complete'), [operations])
  const chosen = targetId === RANDOM ? null : (openOps.find((op) => op.id === targetId) ?? null)
  const fits = (inject: RegieInject) => (chosen ? injectCandidates(inject, [chosen]).length > 0 : injectCandidates(inject, openOps).length > 0)
  const busy = isBusy('alarm') || (chosen !== null && isBusy(`inject:${chosen.id}`))

  const close = () => {
    setOpen(false)
    setView('menu')
  }
  const fire = async (run: () => Promise<boolean>) => {
    if (await run()) close()
  }
  /** The incident an inject hits now: the chosen one, or a fitting one at random. */
  const target = (inject: RegieInject) => {
    const op = chosen ?? pickInjectTarget(inject, openOps)
    if (!op) toast.info(t('regie.noTarget'), { description: t('regie.noTargetHint') })
    return op
  }
  const inject = (kind: RegieInject) => {
    const op = target(kind)
    if (op) void fire(() => actions.inject(kind, op))
  }

  const injects: { kind: RegieInject; icon: LucideIcon; label: string; hint: string }[] = [
    { kind: 'escalate', icon: AlertTriangle, label: t('simulation.injectEscalate'), hint: t('regie.injectEscalateShort') },
    { kind: 'breakdown', icon: Wrench, label: t('simulation.injectBreakdown'), hint: t('regie.injectBreakdownShort') },
    { kind: 'reinforcement', icon: Megaphone, label: t('simulation.injectReinforcement'), hint: t('regie.injectReinforcementShort') },
    { kind: 'pickup', icon: CarTaxiFront, label: t('regie.injectStranded'), hint: t('regie.injectStrandedShort') },
    { kind: 'fieldMessage', icon: MessageSquare, label: t('simulation.injectFieldMessage'), hint: t('regie.injectFieldMessageShort') },
  ]

  const openTargeted = () => {
    setView('targeted')
    if (pools === null || pools === 'failed') {
      setPools(null)
      loadPools().then(setPools, () => setPools('failed'))
    }
  }
  const openNewSite = () => {
    setNewSiteOp(chosen ?? pickInjectTarget('fieldReport', openOps))
    setView('newSite')
  }

  return (
    <>
      <Button size="lg" className={cn('w-full', className)} onClick={() => setOpen(true)} disabled={!state}>
        <Zap className="size-4" />
        {t('regie.stoerung')}
      </Button>
      <RegieSheet
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title={
          view === 'targeted' ? t('regie.alarmTargeted') : view === 'newSite' ? t('regie.newSite') : t('regie.stoerung')
        }
        description={
          view === 'targeted'
            ? t('regie.alarmTargetedHint')
            : view === 'newSite'
              ? newSiteOp
                ? t('regie.newSiteFrom', { place: placeOf(newSiteOp) })
                : t('regie.newSiteNoCrew')
              : t('regie.stoerungHint')
        }
      >
        {view !== 'menu' && (
          <Button variant="ghost" className="-ml-2" onClick={() => setView('menu')}>
            <ArrowLeft className="size-4" />
            {t('regie.back')}
          </Button>
        )}

        {view === 'targeted' && <TargetedAlarm pools={pools} onDone={close} />}

        {view === 'newSite' &&
          (newSiteOp ? (
            <RegieNewSiteForm
              busy={isBusy(`inject:${newSiteOp.id}`)}
              onSend={async (text) => {
                const ok = await actions.fieldReport(newSiteOp, text)
                if (ok) close()
                return ok
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('regie.noTargetHint')}</p>
          ))}

        {view === 'menu' && (
          <>
            <RegieSheetSection title={t('regie.alarms')}>
              <div className="flex flex-col gap-2">
                <RegieTile icon={Droplet} label={t('controls.normal')} hint={t('regie.alarmNormalHint')} disabled={busy} onClick={() => void fire(() => actions.alarm('normal'))} />
                <RegieTile icon={Flame} label={t('controls.critical')} hint={t('regie.alarmCriticalHint')} disabled={busy} onClick={() => void fire(() => actions.alarm('critical'))} />
                <RegieTile icon={Phone} label={t('controls.phoneAlarm')} hint={t('regie.alarmPhoneHint')} disabled={busy} onClick={() => void fire(() => actions.alarm('phone'))} />
                <RegieTile icon={Waves} label={t('regie.alarmWave')} hint={t('regie.alarmWaveHint')} disabled={busy} onClick={() => void fire(() => actions.alarm('wave'))} />
                <RegieTile icon={Target} label={t('regie.alarmTargeted')} hint={t('regie.alarmTargetedShort')} disabled={busy} onClick={openTargeted} />
              </div>
            </RegieSheetSection>

            <RegieSheetSection title={t('regie.injects')}>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="w-full" aria-label={t('regie.target')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={RANDOM}>{t('regie.targetRandom')}</SelectItem>
                  {openOps.map((op) => (
                    <SelectItem key={op.id} value={op.id}>
                      {t('regie.targetIncident', { place: placeOf(op) })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-col gap-2">
                {injects.map(({ kind, icon, label, hint }) => (
                  <RegieTile key={kind} icon={icon} label={label} hint={hint} disabled={busy || !fits(kind)} onClick={() => inject(kind)} />
                ))}
                <RegieTile
                  icon={MessageSquare}
                  label={t('regie.newSite')}
                  hint={t('regie.newSiteShort')}
                  disabled={busy || !fits('fieldReport')}
                  onClick={openNewSite}
                />
                <RegieTile
                  icon={ClipboardCheck}
                  label={t('simulation.rapportBulk')}
                  hint={t('regie.rapportBulkShort')}
                  disabled={busy}
                  onClick={() => void fire(actions.rapportsBulk)}
                />
              </div>
            </RegieSheetSection>
          </>
        )}
      </RegieSheet>
    </>
  )
}

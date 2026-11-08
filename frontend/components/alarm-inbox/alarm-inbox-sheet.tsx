'use client'

/**
 * The Alarmeingang – the alarm pool as a sheet over whatever page is open (owner, 08.11.:
 * «Panel over the board», look 2C). Mounted ONCE in the root layout; opened through
 * `alarm-inbox-store.ts` (header icon, phone «Mehr», user menu, the old `/divera-pool` link).
 *
 * Desktop: a non-modal panel on the right, between the page's header and its footer, no scrim
 * – the board behind stays live and usable, so an attached alarm appears in «Eingegangen» while
 * the panel is still open. Clicking the board does not close it; the ✕, Esc and the header icon
 * do. Phone: the ordinary bottom sheet (modal, grip, swipe), its one bulk action in the footer.
 *
 * Sections (`alarm-groups.ts`): «Neu» with one «Anhängen» per row and «Alle anhängen»,
 * «Heute zugewiesen» as compact rows with the Einsatz number they became, «Früher» folded.
 * Viewers never see it – the interactive pages are closed to them (`ProtectedRoute`).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { ChevronRight, Info, Link2, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/contexts/auth-context'
import { useOperations } from '@/lib/contexts/operations-context'
import { apiClient, type ApiDiveraEmergency } from '@/lib/api-client'
import { wsClient } from '@/lib/websocket-client'
import { getDateFnsLocale } from '@/lib/date-locale'
import { formatDurationSince } from '@/lib/duration'
import { toastLifetime } from '@/lib/toast-lifetime'
import { cn, formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchInput } from '@/components/ui/search-input'
import { LoadingStatus, ShellLoader } from '@/components/ui/shell-loader'
import { useIsMobile } from '@/components/ui/use-mobile'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  ALARM_INBOX_TRIGGER_ATTR,
  closeAlarmInbox,
  reloadAlarmPool,
  useAlarmInboxOpen,
  useAlarmPool,
} from './alarm-inbox-store'
import { groupAlarms } from './alarm-groups'
import { AttachAlarmsDialog } from './attach-alarms-dialog'

/**
 * Where the desktop panel may stand: from the bottom of the page header (the one holding the
 * inbox icon) to the top of the footer toolbar, so neither is covered. Re-measured while open
 * – the board draws its header and footer only once it has loaded, and a route change brings
 * other ones.
 */
function usePanelBand(active: boolean) {
  const pathname = usePathname()
  const [band, setBand] = useState({ top: 0, bottom: 0 })
  useEffect(() => {
    if (!active) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const header = document.querySelector(`[${ALARM_INBOX_TRIGGER_ATTR}]`)?.closest('header')
        const footer = document.querySelector('footer')
        const top = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0
        const bottom = footer ? Math.max(0, Math.round(window.innerHeight - footer.getBoundingClientRect().top)) : 0
        setBand((was) => (was.top === top && was.bottom === bottom ? was : { top, bottom }))
      })
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = new MutationObserver(measure)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [active, pathname])
  return band
}

export function AlarmInboxSheet() {
  const open = useAlarmInboxOpen()
  const { user, isViewer } = useAuth()
  const isMobile = useIsMobile()
  const band = usePanelBand(open && !isMobile)

  // Signed out: the next sign-in starts with it closed.
  useEffect(() => {
    if (!user) closeAlarmInbox()
  }, [user])

  return (
    <Sheet modal={isMobile} open={open && !!user && !isViewer} onOpenChange={(next) => !next && closeAlarmInbox()}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        data-testid="alarm-inbox"
        className={cn(
          'gap-0 p-0 outline-none',
          // --close-edge = the content's end padding (px-4 / px-6), so the ✕ ends on that edge
          isMobile
            ? 'modal-h-tall pb-sheet-safe [--close-edge:1rem]'
            : 'h-auto w-[31.25rem] max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)] [--close-edge:1.5rem]',
        )}
        style={
          isMobile
            ? undefined
            : { top: band.top, bottom: band.bottom, right: 'var(--notification-sidebar-width, 0px)' }
        }
        // Desktop: a panel beside the work, not a layer over it – clicks on the board (and
        // into the attach dialog, which lives outside this element) never close it.
        onInteractOutside={isMobile ? undefined : (event) => event.preventDefault()}
        // Focus goes to the panel, not into the search field: no ring lit on opening, Tab
        // walks on from here (the phone sheet does the same by itself).
        onOpenAutoFocus={(event) => {
          if (isMobile) return
          event.preventDefault()
          if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true })
        }}
      >
        <AlarmInboxPanel isMobile={isMobile} />
      </SheetContent>
    </Sheet>
  )
}

const LABEL = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground'

/** The sheet's contents; mounted only while it is open, so the pool is only live then. */
function AlarmInboxPanel({ isMobile }: { isMobile: boolean }) {
  const t = useTranslations('divera.inbox')
  const tPool = useTranslations('divera.pool')
  const { isEditor } = useAuth()
  const { operations } = useOperations()
  const pool = useAlarmPool()
  const [query, setQuery] = useState('')
  const [earlierOpen, setEarlierOpen] = useState(false)
  const [attachFor, setAttachFor] = useState<readonly ApiDiveraEmergency[] | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    let live = true
    void apiClient.getDemoStatus().then((status) => live && setDemoMode(status?.demo === true))
    return () => {
      live = false
    }
  }, [])

  // While the Alarmeingang is open a new alarm is also said and sounded – what the page did.
  useEffect(
    () =>
      wsClient.on('divera_emergency_received', (data: { emergency: ApiDiveraEmergency; auto_attached?: boolean }) => {
        const { emergency } = data
        // Neutral, not a success: an incoming alarm is news, not something that went well.
        toast(
          emergency.is_training
            ? tPool('newAlarmTraining')
            : emergency.source && emergency.source !== 'divera'
              ? tPool('newAlarmGeneric')
              : tPool('newEmergency'),
          {
            description: data.auto_attached ? tPool('autoAttached', { title: emergency.title }) : emergency.title,
            ...toastLifetime(10000),
          },
        )
        playAlertSound()
      }),
    [tPool],
  )

  const now = Date.now()
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? pool.emergencies.filter((e) =>
        [e.title, e.text, e.address, e.divera_number, e.source].some((field) => field?.toLowerCase().includes(needle)),
      )
    : pool.emergencies
  const groups = groupAlarms(matches, now)
  const numbers = useMemo(() => new Map(operations.map((op) => [op.id, op.number ?? null])), [operations])
  const showEarlier = earlierOpen || !!needle
  const canAttachAll = isEditor && groups.fresh.length > 1

  const ago = (iso: string) => {
    try {
      return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: getDateFnsLocale() })
    } catch {
      return iso
    }
  }

  // `compact`: in a one-line row. The phone keeps its 44px touch rule either way.
  const attachButton = (alarms: readonly ApiDiveraEmergency[], label: string, ariaLabel?: string, compact = false) => (
    <Button
      size={isMobile ? 'default' : compact ? 'xs' : 'sm'}
      variant="outline"
      onClick={() => setAttachFor(alarms)}
      aria-label={ariaLabel}
    >
      <Link2 className="size-3.5" />
      {label}
    </Button>
  )

  // What sits at the end of a compact row: the Einsatz it became, or its state.
  const compactEnd = (e: ApiDiveraEmergency): ReactNode => {
    const number = e.created_incident_id ? numbers.get(e.created_incident_id) : null
    if (number != null)
      return (
        <span className="rounded-sm border border-border px-1.5 py-px text-xs whitespace-nowrap">
          <span aria-hidden>→ </span>
          <span className="sr-only">{t('becameIncident')} </span>
          <span className="font-mono font-semibold">{number}</span>
        </span>
      )
    if (e.attached_to_event_id) return <span className="text-xs text-muted-foreground">{tPool('assigned')}</span>
    if (e.is_archived) return <span className="text-xs text-muted-foreground">{tPool('archived')}</span>
    return isEditor ? attachButton([e], tPool('attach'), t('attachOneAria', { title: e.title }), true) : null
  }

  const badges = (e: ApiDiveraEmergency) => (
    <>
      {e.is_training && (
        <Badge variant="outline" className="border-warning/60 text-warning-foreground">
          {tPool('trainingBadge')}
        </Badge>
      )}
      {/* Alarms from the generic webhook show their sender slug */}
      {!e.is_training && e.source && e.source !== 'divera' && (
        <Badge variant="outline" className="uppercase">
          {e.source}
        </Badge>
      )}
    </>
  )

  const compactRow = (e: ApiDiveraEmergency) => (
    <li
      key={e.id}
      className="flex items-center gap-3 px-4 py-2 text-sm md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto] md:gap-x-3 md:px-6 md:py-1.5"
    >
      {/* phone: title over «address · time»; desktop: the wrappers dissolve into one grid row */}
      <div className="min-w-0 flex-1 md:contents">
        <span className="block truncate font-medium" title={e.title}>
          {e.title}
        </span>
        <span className="flex min-w-0 gap-2 text-muted-foreground md:contents">
          {/* the street as the board shows it (home town dropped), the full address on hover */}
          <span className="min-w-0 truncate" title={e.address ?? undefined}>
            {e.address ? formatLocationForDisplay(e.address, getGlobalHomeCity()) || e.address : null}
          </span>
          <time className="shrink-0 tabular-nums" dateTime={e.received_at} title={ago(e.received_at)}>
            {formatDurationSince(new Date(e.received_at), now)}
          </time>
        </span>
      </div>
      <span className="flex shrink-0 justify-end">{compactEnd(e)}</span>
    </li>
  )

  let body: ReactNode
  if (!pool.loaded) {
    body = (
      <div className="flex h-48 items-center justify-center">
        <LoadingStatus size="surface" className="text-sm">
          {tPool('loading')}
        </LoadingStatus>
      </div>
    )
  } else if (pool.emergencies.length === 0) {
    body = demoMode ? (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-muted-foreground">
        <Info className="size-6 text-warning-foreground" aria-hidden />
        <p className="font-medium text-foreground">{tPool('demoTitle')}</p>
        <p className="text-sm">
          {tPool.rich('demoDescription', { b: (chunks) => <span className="font-medium">{chunks}</span> })}
        </p>
      </div>
    ) : (
      <EmptyState compact title={t('emptyTitle')} description={t('emptyDescription')} />
    )
  } else if (matches.length === 0) {
    body = (
      <EmptyState
        compact
        title={t('noMatches', { query: query.trim() })}
        action={{ label: tPool('resetSearch'), onClick: () => setQuery('') }}
      />
    )
  } else {
    body = (
      <>
        {(groups.fresh.length > 0 || !needle) && (
          <section aria-label={t('sectionNew', { count: groups.fresh.length })}>
            <div className="flex min-h-11 items-center justify-between gap-3 px-4 pt-2 md:px-6">
              <h3 className={LABEL}>{t('sectionNew', { count: groups.fresh.length })}</h3>
              {canAttachAll && !isMobile && (
                <Button variant="link" size="xs" className="px-0 text-sm" onClick={() => setAttachFor(groups.fresh)}>
                  {t('attachAll')}
                </Button>
              )}
            </div>
            {groups.fresh.length === 0 ? (
              <p className="px-4 pb-3 text-sm text-muted-foreground md:px-6">{t('nothingNew')}</p>
            ) : (
              <ul>
                {groups.fresh.map((e) => (
                  <li key={e.id} className="flex gap-3 px-4 py-3 md:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-start gap-2 font-semibold leading-5">
                        <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-foreground" />
                        {badges(e)}
                        <span className="min-w-0 break-words">{e.title}</span>
                      </p>
                      {e.address && <p className="mt-0.5 text-sm break-words text-muted-foreground">{e.address}</p>}
                      {e.text && (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" title={e.text}>
                          {e.text}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <time className="text-sm whitespace-nowrap text-muted-foreground" dateTime={e.received_at}>
                        {ago(e.received_at)}
                      </time>
                      {isEditor && attachButton([e], tPool('attach'), t('attachOneAria', { title: e.title }))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {groups.today.length > 0 && (
          <section aria-label={t('sectionToday', { count: groups.today.length })}>
            <h3 className={cn(LABEL, 'px-4 pt-4 pb-1.5 md:px-6')}>{t('sectionToday', { count: groups.today.length })}</h3>
            <ul>{groups.today.map(compactRow)}</ul>
          </section>
        )}

        {groups.earlier.length > 0 && (
          <section className="mt-2 border-t border-border">
            <button
              type="button"
              aria-expanded={showEarlier}
              onClick={() => setEarlierOpen((was) => !was)}
              className={cn(
                LABEL,
                'flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-4 hover:text-foreground md:px-6',
              )}
            >
              <span className="flex items-center gap-1.5">
                <ChevronRight className={cn('size-3.5 transition-transform', showEarlier && 'rotate-90')} aria-hidden />
                {t('sectionEarlier', { count: groups.earlier.length })}
              </span>
              <span className="font-normal tracking-normal normal-case">{t('earlierHint')}</span>
            </button>
            {showEarlier && <ul className="pb-3">{groups.earlier.map(compactRow)}</ul>}
          </section>
        )}
      </>
    )
  }

  return (
    <>
      <SheetHeader className="gap-0.5 px-4 pt-4 pb-3 md:px-6">
        <SheetTitle className="text-lg font-bold">{t('title')}</SheetTitle>
        <SheetDescription>{t('summary', { count: pool.total })}</SheetDescription>
      </SheetHeader>
      <div className="flex items-center gap-2 border-b border-border px-4 pb-3 md:px-6">
        <SearchInput
          containerClassName="min-w-0 flex-1"
          placeholder={tPool('searchPlaceholder')}
          value={query}
          onValueChange={setQuery}
        />
        <Button
          variant="outline"
          size={isMobile ? 'icon' : 'icon-sm'}
          onClick={() => void reloadAlarmPool()}
          disabled={pool.loading}
          aria-label={t('refresh')}
          title={t('refresh')}
        >
          {pool.loading ? <ShellLoader className="size-3.5" /> : <RefreshCw className="size-3.5" />}
        </Button>
      </div>

      {/* relative: the chips' sr-only words are positioned inside the scroller, not the page */}
      <SheetBody className="relative pb-4">{body}</SheetBody>

      {canAttachAll && isMobile && (
        <SheetFooter className="border-t border-border px-4 pt-3 pb-0">
          <Button onClick={() => setAttachFor(groups.fresh)}>
            <Link2 className="size-4" />
            {t('attachAllCount', { count: groups.fresh.length })}
          </Button>
        </SheetFooter>
      )}

      <AttachAlarmsDialog alarms={attachFor} onClose={() => setAttachFor(null)} onAttached={() => void reloadAlarmPool()} />
    </>
  )
}

/** A short 800 Hz beep for a new alarm (the page's sound, unchanged). */
function playAlertSound() {
  const AudioContextCtor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return
  const audioContext = new AudioContextCtor()
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()
  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)
  oscillator.frequency.value = 800
  oscillator.type = 'sine'
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5)
  oscillator.start(audioContext.currentTime)
  oscillator.stop(audioContext.currentTime + 0.5)
}

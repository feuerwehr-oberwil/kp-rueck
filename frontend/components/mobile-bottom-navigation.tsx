'use client'

/**
 * Mobile Bottom Navigation Component
 * Bottom tab bar for mobile devices with iOS/Android safe area support.
 *
 * The phone frame (owner picks 1A + 2A, phone sweep 24.11.2026): five tiles – Einsätze ·
 * Lagekarte · Personal · Meldungen · Mehr. The two pages are links; Personal opens the phone
 * Personal sheet, Meldungen the bell's list (`PhoneNotificationSheet`, with the count of what is
 * open in it – amber when to-dos wait, see `MeldungenTile`), Mehr the tools for the open Ereignis. The Ereignis, Einstellungen, Hilfe and the
 * account live in the pill's menu (`PhoneEventPill`), not here (owner, sign-off 24.11.2026).
 *
 * The tab pill (owner's pick 4A, 14.11.2026): 8px of air above and below icon + label, and it
 * never grows – no scale on the current tab, no bounce on a tap. The tap answers with the app's
 * press wash (globals.css), like every other control.
 *
 * Every «Mehr» entry is the same ghost row: a page link is the Button itself (`asChild`), not a
 * 21px <a> wrapped around a 44px <button> (phone sweep 14.11.2026).
 *
 * «Mehr» is the same menu on every page (owner, 16.11.2026): the Schnellzugriff sheets are the
 * nav's own (`PhoneQuickSheets`), not handed in by the board – the Lagekarte used to offer only
 * Kennzahlen there.
 *
 * Phone sweep 24.11.2026: a tab answers on the tap (#2) – its tint moves and the top loading bar
 * starts before the next page has loaded; every page lights the tab it belongs to (#24,
 * `TAB_OF_PAGE`); «Mehr» keeps its head while its list scrolls (#9) and arrives as one piece with
 * the sheet, no entrance of its own (#25); a held finger on the bar selects nothing and opens no
 * link preview (#26, `select-none` + no touch callout).
 */

import { BookOpenText, Bell, ChartColumn, Columns3, Map as MapIcon, MoreHorizontal, QrCode, Sparkles, Users, Truck, Printer } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useRef, useState, type Ref, type RefObject } from 'react'
import { topLoading } from '@/components/ui/top-loading-bar'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Sheet, SheetBody, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { useNavReserve } from '@/components/viewport-insets'
import { toggleFigures } from '@/components/figures-dialog'
import { PhoneQuickSheets, type PhoneQuickSheet } from '@/components/mobile/phone-quick-sheets'
import { PhoneNotificationSheet } from '@/components/notifications/phone-notification-sheet'
import { useNewAlarmCount } from '@/components/alarm-inbox/alarm-inbox-button'
import { useIsMobile } from '@/components/ui/use-mobile'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useBellCount, useOpenFieldRequests } from '@/lib/hooks/use-field-requests'
import { useTodos } from '@/lib/hooks/use-todos'
import { GPS_TODO_TYPES } from '@/lib/todos'

/** The tiles that are a place: the two pages and «Mehr». Personal and Meldungen open a sheet
 *  over the page and are never where the operator is. */
type NavTab = 'kanban' | 'map' | 'more'

/** The pages that show the bottom nav, and the tab each one lights: the two real tabs, «Mehr»
 *  for the Übungs-Steuerung reached from it, none for the Ereignis pill's pages («Alle
 *  Ereignisse», Einstellungen, Hilfe), which the pill marks in its menu. A new page has to say
 *  where it belongs. */
const TAB_OF_PAGE = {
  kanban: 'kanban',
  map: 'map',
  events: null,
  training: 'more',
  settings: null,
  help: null,
} as const satisfies Record<string, NavTab | null>

export type NavPage = keyof typeof TAB_OF_PAGE

interface MobileBottomNavigationProps {
  currentPage: NavPage
  hasSelectedEvent?: boolean
}

/** «9+» past nine, like the desk's bell. */
const badgeText = (count: number) => (count > 9 ? '9+' : String(count))

export function MobileBottomNavigation({
  currentPage,
  hasSelectedEvent = true,
}: MobileBottomNavigationProps) {
  const t = useTranslations('nav.mobileBottomNav')
  const { isEditor, isAuthenticated } = useAuth()
  const { selectedEvent } = useEvent()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [meldungenOpen, setMeldungenOpen] = useState(false)
  // The Personal and Meldungen tiles open sheets they are no SheetTrigger of: each sheet hands
  // focus back to its tile when it closes (Radix would otherwise drop it on <body>).
  const personnelTileRef = useRef<HTMLButtonElement>(null)
  const meldungenTileRef = useRef<HTMLButtonElement>(null)
  const focusTile = (tile: RefObject<HTMLButtonElement | null>) => (event: Event) => {
    event.preventDefault()
    tile.current?.focus()
  }
  // The tab just tapped, while its page is still on the way: it lights at once. Tied to the
  // page it was tapped on, so once the route has moved on (or back) it no longer applies.
  const [pending, setPending] = useState<{ tab: NavTab; from: NavPage } | null>(null)
  const litTab: NavTab | null = pending?.from === currentPage ? pending.tab : TAB_OF_PAGE[currentPage]
  // The sheet a tile or Schnellzugriff opened over the page (`PhoneQuickSheets`, phone only).
  const [quickSheet, setQuickSheet] = useState<PhoneQuickSheet | null>(null)
  const isMobile = useIsMobile()
  // Publishes this bar's measured height as `--nav-reserve` — the one number every phone list
  // pads its end by (`pb-nav-reserve`) and the toast lane clears.
  const navRef = useRef<HTMLElement>(null)
  useNavReserve(navRef)

  const tabs: { id: 'kanban' | 'map'; label: string; icon: LucideIcon; href: string; disabled: boolean }[] = [
    {
      id: 'kanban',
      label: t('incidents'),
      // Same glyph as the desktop nav's board entry — see page-navigation.tsx.
      icon: Columns3,
      href: '/',
      disabled: !hasSelectedEvent,
    },
    {
      id: 'map',
      label: t('map'),
      icon: MapIcon,
      href: '/map',
      disabled: !hasSelectedEvent,
    },
  ]

  // «Mehr» is «Schnellzugriff» alone and needs an Ereignis: every entry is about the open one,
  // so without one the tile is off, like Personal. The editing sheets (links, vehicles, print)
  // are an editor's; the Tagebuch and Kennzahlen everyone's. Personal is a tile of its own.
  const quickActions: { id: string; label: string; icon: LucideIcon; open: () => void }[] = selectedEvent
    ? [
        ...(isEditor ? [{ id: 'links', label: t('linksAndQr'), icon: QrCode, open: () => setQuickSheet('links') }] : []),
        { id: 'journal', label: t('journal'), icon: BookOpenText, open: () => setQuickSheet('journal') },
        { id: 'figures', label: t('figures'), icon: ChartColumn, open: toggleFigures },
        ...(isEditor
          ? [
              { id: 'vehicles', label: t('vehicles'), icon: Truck, open: () => setQuickSheet('vehicles') },
              { id: 'print', label: t('print'), icon: Printer, open: () => setQuickSheet('print') },
            ]
          : []),
      ]
    : []

  // One tab's frame: a 56px pill (8px + 20px icon + 4px + 16px label + 8px), so the current
  // tab's tint has air around its content; the bar adds 4px above and below it.
  const tabClass = "flex min-w-0 flex-col items-center justify-center gap-1 flex-1 min-h-[44px] py-2 rounded-lg transition-colors touch-manipulation"
  const litClass = (tab: NavTab | null) =>
    tab !== null && litTab === tab ? "bg-foreground/[0.09] text-foreground" : "text-muted-foreground hover:text-foreground"

  /** A link out of «Mehr» (its `onNavigate`, so not a modified click into a new tab): the
   *  loading bar starts on the tap, not once the next page renders. It also supersedes a tab
   *  tapped a moment ago – back to the page it is on, that tab's tint and load are off. */
  const leave = (href: string) => () => {
    setPending(null)
    if (href === window.location.pathname) topLoading.cancelRoute()
    else topLoading.startRoute()
  }

  return (
    // The nav shares the overlay rung rather than sitting under it (which is where a plain
    // page element belongs): a sheet or dialog still covers it, because every one of those is
    // portalled to the end of <body> and so comes later in the DOM at the same z-index. See
    // the z-order block in app/globals.css.
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-overlay border-t border-border bg-card/95 backdrop-blur-sm md:hidden select-none [-webkit-touch-callout:none]"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}
    >
      <div className="flex items-center justify-around min-h-[60px] px-2 py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = litTab === tab.id

          return (
            <Link
              key={tab.id}
              href={tab.href}
              // Next calls it for an in-app navigation only – not a modified click into a new tab
              onNavigate={() => {
                if (TAB_OF_PAGE[currentPage] === tab.id) {
                  // back to the page it is on before the other one arrived: that one is off
                  setPending(null)
                  topLoading.cancelRoute()
                  return
                }
                setPending({ tab: tab.id, from: currentPage })
                topLoading.startRoute()
              }}
              className={cn(tabClass, litClass(tab.id), tab.disabled && "opacity-40 pointer-events-none")}
              aria-label={tab.label}
              aria-current={TAB_OF_PAGE[currentPage] === tab.id ? 'page' : undefined}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className={cn("text-xs font-medium", isActive && "font-semibold")}>{tab.label}</span>
            </Link>
          )
        })}

        {/* Personal and Meldungen open a sheet over the page they are tapped on; neither is a
            page, so neither ever lights. */}
        <button
          ref={personnelTileRef}
          type="button"
          className={cn(tabClass, litClass(null), "disabled:opacity-40")}
          aria-haspopup="dialog"
          // the roster of the open Ereignis: without one there is nothing to show
          disabled={!selectedEvent}
          onClick={() => setQuickSheet('personnel')}
        >
          <Users className="h-5 w-5" aria-hidden="true" />
          <span className="text-xs font-medium">{t('personnel')}</span>
        </button>
        {/* Signed in only (/help is public). Its count subscribes to the bell and the
            Alarmeingang, so only a phone counts: the desk's hidden bar shows a plain tile. */}
        {isAuthenticated && (
          <MeldungenTile
            ref={meldungenTileRef}
            className={cn(tabClass, litClass(null))}
            live={isMobile}
            onOpen={() => setMeldungenOpen(true)}
          />
        )}

        {/* More menu */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(tabClass, litClass('more'), "disabled:opacity-40")}
              aria-label={t('moreOptions')}
              disabled={!selectedEvent}
              // a page behind «Mehr» is where the operator is – said to a screen reader too
              aria-current={TAB_OF_PAGE[currentPage] === 'more' ? 'page' : undefined}
            >
              <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              <span className={cn("text-xs font-medium", litTab === 'more' && "font-semibold")}>{t('more')}</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            // No `animate-sheet-slide-up`: it duplicated SheetContent's own
            // `slide-in-from-bottom` and, being unscoped by `data-state`, it kept
            // `animation-name` non-`none` on the *closed* sheet — which is exactly
            // what makes Radix's Presence hold the dismissed panel mounted (and
            // hit-testable) for another ~150ms. Measured; the entrance is unchanged.
            // The head stays, the body scrolls under it (phone sweep 24.11.2026 #9: the whole
            // sheet used to scroll, title, grip and ✕ with it). It covers the nav, so the
            // body's foot only pays the safe area (`pb-sheet-safe`).
            className="modal-h-tall gap-0 p-0"
          >
            <SheetHeader>
              <SheetTitle>{t('moreFunctions')}</SheetTitle>
            </SheetHeader>

            <SheetBody className="space-y-4 px-6 pt-1 pb-sheet-safe">
              {/* Viewing-first: the QR/print/vehicle sheets are editor-only, so viewers get a
                  decluttered sheet. The training link shows on any Übung: spawning training
                  incidents is the main mobile task, done with an editor account – the viewer
                  role is strictly read-only (/training refuses it). */}
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  {t('quickActions')}
                </h3>
                <div className="space-y-1">
                  {/* Close «Mehr» first, then open the sheet: one layer at a time. */}
                  {quickActions.map((action) => {
                    const Icon = action.icon
                    return (
                      <Button
                        key={action.id}
                        variant="ghost"
                        className="w-full justify-start gap-3 touch-manipulation"
                        onClick={() => {
                          setSheetOpen(false)
                          setTimeout(action.open, 350)
                        }}
                      >
                        <Icon className="size-4" />
                        <span>{action.label}</span>
                      </Button>
                    )
                  })}

                  {/* Training Control - only for training events */}
                  {selectedEvent?.training_flag && (
                    <Button
                      asChild
                      variant="ghost"
                      className="w-full justify-start gap-3 touch-manipulation"
                    >
                      <Link href="/training" onClick={() => setSheetOpen(false)} onNavigate={leave("/training")}>
                        <Sparkles className="size-4 text-muted-foreground" />
                        <span>{t('trainingControl')}</span>
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </SheetBody>
          </SheetContent>
        </Sheet>
        {isMobile && (
          <PhoneQuickSheets
            open={quickSheet}
            onOpenChange={setQuickSheet}
            onPersonnelCloseFocus={focusTile(personnelTileRef)}
          />
        )}
        {isMobile && isAuthenticated && (
          <PhoneNotificationSheet open={meldungenOpen} onOpenChange={setMeldungenOpen} returnFocusTo={meldungenTileRef} />
        )}
      </div>
    </nav>
  )
}

interface MeldungenTileProps {
  ref: Ref<HTMLButtonElement>
  className: string
  /** Count what is open (a phone). Off, the tile subscribes to nothing and shows no number. */
  live: boolean
  onOpen: () => void
}

/** The Meldungen tile: the bell's open entries, plus the Alarmeingang's new alarms for everyone
 *  the Alarmeingang lets in (not a viewer). Split by who counts what, so each subscribes only to
 *  what it shows.
 *
 *  It is the phone's loud bell (owner pick 24.11.2026 – the phone has no header bell): while
 *  to-dos wait for an editor, the badge is amber and counts them («Zu erledigen» plus the field's
 *  open requests, like the desk's bell), and red with a pulse once one is open longer than 5'. */
function MeldungenTile({ live, ...props }: MeldungenTileProps) {
  const { isViewer } = useAuth()
  if (!live) return <MeldungenButton {...props} count={0} />
  return isViewer ? <BellTile {...props} alarms={0} /> : <BellAndAlarmTile {...props} />
}

type TileProps = Omit<MeldungenTileProps, 'live'>

function BellAndAlarmTile(props: TileProps) {
  return <BellTile {...props} alarms={useNewAlarmCount()} />
}

function BellTile({ alarms, ...props }: TileProps & { alarms: number }) {
  const { notifications } = useNotifications()
  // The GPS rows are to-dos: counted by `useTodos` while still a question, never as Meldungen.
  const messages = useMemo(() => notifications.filter((n) => !GPS_TODO_TYPES.has(n.type)), [notifications])
  const { count } = useBellCount(messages, useOpenFieldRequests())
  const todos = useTodos()
  return <MeldungenButton {...props} count={count + alarms} todos={todos} />
}

function MeldungenButton({
  ref,
  className,
  onOpen,
  count,
  todos,
}: TileProps & { count: number; todos?: { count: number; overdue: boolean } }) {
  const t = useTranslations('nav.mobileBottomNav')
  const tTodo = useTranslations('notifications.todo')
  const loud = (todos?.count ?? 0) > 0
  const shown = loud ? todos!.count : count
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      aria-haspopup="dialog"
      aria-label={loud ? tTodo('bellAria', { count: shown }) : t('notificationsOpen', { count })}
      onClick={onOpen}
    >
      <span className="relative">
        <Bell className="h-5 w-5" aria-hidden="true" />
        {shown > 0 && (
          <span
            aria-hidden
            data-testid="meldungen-badge"
            data-todo={loud ? (todos!.overdue ? 'overdue' : 'open') : undefined}
            className={cn(
              'absolute -top-1.5 left-3 flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-mono text-xs font-semibold',
              !loud && 'bg-foreground text-background',
              // Red is an edge and the text, never a fill (DESIGN.md «Colour roles»), as on the desk.
              loud && !todos!.overdue && 'bg-warning text-foreground',
              loud && todos!.overdue && 'bg-card text-destructive ring-2 ring-destructive motion-safe:animate-pulse',
            )}
          >
            {badgeText(shown)}
          </span>
        )}
      </span>
      <span className="text-xs font-medium">{t('notifications')}</span>
    </button>
  )
}

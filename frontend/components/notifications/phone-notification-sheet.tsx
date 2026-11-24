'use client'

/**
 * The phone's «Meldungen» (owner pick 1A, phone sweep 24.11.2026): the bell's list as a bottom
 * sheet, opened by the bottom nav's Meldungen tile. Board toasts stay muted on a phone, so this is
 * where a missed Feld request, Abholung or Verstärkung is found again.
 *
 * The tile counts what is open here (`useMeldungenCount`): the bell's entries with the open field
 * requests folded in, plus the new alarms of the Alarmeingang – so the Alarmeingang is the sheet's
 * first row, and the count always has a row that explains it.
 *
 * Read-only for the board (owner, 14.11.2026): no status move on a card, no request worked from
 * here. Closing a notification and «Gesehen» stay – they are the reader's, not the board's.
 */

import { Bell, ChevronRight, Inbox } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AlarmInboxMenuCount, useNewAlarmCount } from '@/components/alarm-inbox/alarm-inbox-button'
import { openAlarmInbox } from '@/components/alarm-inbox/alarm-inbox-store'
import { FieldRequestInbox } from '@/components/notifications/field-request-inbox'
import { NotificationCard } from '@/components/notifications/notification-card'
import { Button } from '@/components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useBellCount, useOpenFieldRequests } from '@/lib/hooks/use-field-requests'
import type { OperationDetailTab } from '@/lib/hooks/use-operation-detail-shortcuts'

/** What the Meldungen tile counts: the bell's open entries and the new alarms. */
export function useMeldungenCount(): number {
  const { notifications } = useNotifications()
  const { count } = useBellCount(notifications, useOpenFieldRequests())
  return count + useNewAlarmCount()
}

interface PhoneNotificationSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PhoneNotificationSheet({ open, onOpenChange }: PhoneNotificationSheetProps) {
  const t = useTranslations('notifications.sidebar')
  const tNav = useTranslations('nav.mobileBottomNav')
  const tInbox = useTranslations('divera.inbox')
  const { notifications, dismissNotification, dismissAllNotifications, navigateToIncident } = useNotifications()
  const openRequests = useOpenFieldRequests()

  // A row opens its Einsatz on the tab it is about: the board's sheet when the board is open,
  // the board's deep link from any other page (notification-context.tsx).
  const openIncident = (incidentId: string, tab?: OperationDetailTab) => {
    onOpenChange(false)
    navigateToIncident(incidentId, tab)
  }

  // As on the desk sidebar: an open request stands for its bell entry.
  const activeNotifications = notifications.filter((n) => !n.dismissed && !openRequests.representedIds.has(n.id))
  const historicalNotifications = notifications.filter((n) => n.dismissed).slice(0, 20)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* The frame of every phone sheet: the head stays, the body scrolls. It covers the nav, so
          the body's foot only pays the safe area. */}
      <SheetContent side="bottom" className="modal-h-tall gap-0 p-0">
        <SheetHeader>
          <SheetTitle>{tNav('notifications')}</SheetTitle>
        </SheetHeader>

        <SheetBody className="space-y-4 px-6 pt-1 pb-sheet-safe">
          {/* The Alarmeingang is a sheet of its own: close this one first, then open it (one
              layer at a time, the hand-over «Mehr» uses). */}
          <Button
            variant="outline"
            className="h-auto min-h-11 w-full justify-start gap-3 touch-manipulation"
            onClick={() => {
              onOpenChange(false)
              setTimeout(openAlarmInbox, 350)
            }}
          >
            <Inbox className="size-4" />
            <span>{tInbox('title')}</span>
            <AlarmInboxMenuCount className="ml-auto" />
            <ChevronRight className="size-4 text-muted-foreground" />
          </Button>

          <FieldRequestInbox
            items={openRequests.items}
            readOnly
            onOpenIncident={(incidentId) => openIncident(incidentId, 'rapport')}
          />

          {activeNotifications.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {t('activeHeading')}
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground/10 px-1.5 text-xs font-bold text-foreground">
                    {activeNotifications.length}
                  </span>
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void dismissAllNotifications(openRequests.representedIds)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {t('dismissAll')}
                </Button>
              </div>
              <div className="space-y-2">
                {activeNotifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onDismiss={dismissNotification}
                    onClickIncident={openIncident}
                    readOnly
                  />
                ))}
              </div>
            </section>
          )}

          {activeNotifications.length === 0 && openRequests.items.length === 0 && (
            <div className="py-10 text-center text-muted-foreground">
              <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-muted">
                <Bell className="size-8 opacity-40" />
              </div>
              <p className="text-sm font-medium">{t('emptyTitle')}</p>
              <p className="mt-1 text-xs">{t('emptySubtitle')}</p>
            </div>
          )}

          {historicalNotifications.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('historyHeading')}</h3>
              <div className="space-y-2">
                {historicalNotifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onClickIncident={openIncident}
                    readOnly
                  />
                ))}
              </div>
            </section>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

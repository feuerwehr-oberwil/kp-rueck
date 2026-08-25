'use client'

/**
 * One notification row — the bell's sheet and the persistent sidebar render the
 * SAME component now. They were two copies of eighty identical lines, which is
 * how one of them ends up with an action the other does not have.
 *
 * A field report («angekommen», «Einsatz beendet») carries that action: the
 * board asks the same question on the card itself (see `FieldStatusNudge`), and
 * answering it used to mean finding the card first. The button here is the same
 * answer, given from the list — and deliberately still an answer, not an
 * automatic move: the crew reports a fact, the column is the KP's decision, and
 * it runs through the same gates a drag does.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle, ArrowRight, Info, AlertCircle, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/contexts/auth-context'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useOperations } from '@/lib/contexts/operations-context'
import { fieldNudgeForNotification } from '@/lib/notification-field-action'
import { formatNotificationTime } from '@/lib/notification-time'
import { detailTabForNotification } from '@/lib/notification-detail-tab'
import type { Notification, NotificationSeverity } from '@/lib/types/notification'
import type { OperationDetailTab } from '@/lib/hooks/use-operation-detail-shortcuts'
import { cn } from '@/lib/utils'

type SeverityStyle = {
  border: string
  bg: string
  icon: React.ReactNode
  badge: string
}

/** `compact` is the persistent sidebar (narrow column), `default` the sheet. */
function severityStyles(severity: NotificationSeverity, compact: boolean): SeverityStyle {
  const iconSize = compact ? 'h-4 w-4' : 'h-5 w-5'
  switch (severity) {
    case 'critical':
      return {
        border: 'border-l-2 border-l-destructive/40',
        bg: 'bg-destructive/5',
        icon: <AlertCircle className={cn(iconSize, 'text-destructive/50')} />,
        badge: 'bg-destructive/10 text-destructive/80',
      }
    case 'warning':
      return {
        border: 'border-l-2 border-l-warning/50',
        bg: 'bg-warning/10',
        icon: <AlertTriangle className={cn(iconSize, 'text-warning-foreground')} />,
        badge: 'bg-warning/10 text-warning-foreground',
      }
    case 'info':
      return {
        border: 'border-l-2 border-l-muted-foreground/40',
        bg: 'bg-muted/30',
        icon: <Info className={cn(iconSize, 'text-muted-foreground/70')} />,
        badge: 'bg-muted text-muted-foreground',
      }
  }
}

export interface NotificationCardProps {
  notification: Notification
  onDismiss?: (id: string) => void
  onClickIncident?: (incidentId: string, tab?: OperationDetailTab) => void
  variant?: 'default' | 'compact'
  /**
   * Whether clicking the row also dismisses the notification. True where the
   * click ACTS on it (the sheet navigates away); false where it only points —
   * the persistent sidebar highlights the board card and stays open, and a
   * pointer must not clear the alert for every other board.
   */
  dismissOnClick?: boolean
}

export function NotificationCard({
  notification,
  onDismiss,
  onClickIncident,
  variant = 'default',
  dismissOnClick = true,
}: NotificationCardProps) {
  const t = useTranslations('notifications.card')
  const tSidebar = useTranslations('notifications.sidebar')
  const compact = variant === 'compact'
  const styles = severityStyles(notification.severity, compact)
  const { isEditor } = useAuth()
  const { fieldAction } = useNotifications()
  const { operations } = useOperations()

  const severityLabel =
    notification.severity === 'critical'
      ? t('severityCritical')
      : notification.severity === 'warning'
        ? t('severityWarning')
        : t('severityInfo')

  const isClickable = !!notification.incident_id && !!onClickIncident

  // The move this notification is asking for, if it is still open. Nothing is
  // offered for a card that has already been moved — by a drag, by the nudge on
  // the card, or by this button a moment ago.
  const operation = notification.incident_id
    ? operations.find((op) => op.id === notification.incident_id)
    : undefined
  const nudge = operation ? fieldNudgeForNotification(notification.type, operation) : null
  const showAction = !!nudge && !!fieldAction && isEditor && !notification.dismissed

  return (
    <div
      className={cn(
        // No all-round `border`: it paints four grey sides, and the severity's
        // `border-l-2` then recolours only the left — so at the rounded corners the
        // grey hooked over the coloured stripe. The stripe is the whole signal; the
        // background carries the rest.
        'rounded-lg p-3 transition-all duration-200',
        styles.border,
        styles.bg,
        notification.dismissed && (compact ? 'opacity-50' : 'opacity-60'),
        isClickable && 'cursor-pointer hover:ring-1 hover:ring-ring/30',
      )}
      role="article"
      aria-label={`${severityLabel} notification`}
      onClick={() => {
        if (!isClickable) return
        if (dismissOnClick && !notification.dismissed && onDismiss) onDismiss(notification.id)
        // The bell is a pointer: open the tab the notification is ABOUT, not
        // the one the operator happens to have remembered (§18.27).
        onClickIncident(notification.incident_id!, detailTabForNotification(notification.type))
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex-shrink-0">{styles.icon}</div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', styles.badge)}>
              {severityLabel}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {formatNotificationTime(notification.created_at, t)}
            </span>
          </div>

          <p className="text-sm leading-snug break-words text-foreground">{notification.message}</p>

          {showAction && (
            <Button
              size="xs"
              variant="outline"
              className="mt-2"
              // The row itself opens the incident; this button answers instead.
              onClick={(event) => {
                event.stopPropagation()
                fieldAction!(notification.incident_id!, nudge!.kind)
                if (!notification.dismissed && onDismiss) onDismiss(notification.id)
              }}
            >
              <ArrowRight className="size-3.5" />
              {t(nudge.kind === 'complete' ? 'moveToComplete' : 'moveToActive')}
            </Button>
          )}
        </div>

        {!notification.dismissed && onDismiss && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="flex-shrink-0 hover:bg-background/80"
            onClick={(event) => {
              event.stopPropagation()
              onDismiss(notification.id)
            }}
            aria-label={tSidebar('dismissAria')}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

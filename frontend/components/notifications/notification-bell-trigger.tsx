'use client'

import { useTranslations } from 'next-intl'
import { ShortcutTooltip } from '@/components/ui/shortcut-tooltip'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useTodos } from '@/lib/hooks/use-todos'
import { useAuth } from '@/lib/contexts/auth-context'
import { BellButton } from './bell-button'

/** The bell in the desk header: the loud to-do button, or the plain bell (`BellButton`); it
 *  toggles the rail (`B`). A phone has no header bell: its bottom nav's «Meldungen» tile opens
 *  the list as a sheet (`PhoneNotificationSheet`). */
export function NotificationBellTrigger() {
  const t = useTranslations('notifications.sidebar')
  const { toggleSidebar, isSidebarOpen } = useNotifications()
  const todos = useTodos()
  const { isAuthenticated } = useAuth()

  // Notifications are an authenticated-only feature — no bell when logged out
  if (!isAuthenticated) return null

  return (
    <ShortcutTooltip label={t('bellTitle')} keys={['B']} side="bottom">
      <BellButton state={todos} pressed={isSidebarOpen} onClick={toggleSidebar} />
    </ShortcutTooltip>
  )
}

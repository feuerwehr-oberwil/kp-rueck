/**
 * Relative age of a notification ("vor 5 Min", "vor 2 Std", "gerade eben").
 *
 * Both notification sidebars — the bell popover and the persistent one — carried
 * a byte-identical copy of this, down to the i18n keys. One copy, two callers.
 *
 * `t` is the `notifications` translator from the calling component, so the
 * keys (`timeDays`/`timeHours`/`timeMinutes`/`justNow`) stay where they are.
 */
export function formatNotificationTime(
  date: Date,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return t('timeDays', { days })
  if (hours > 0) return t('timeHours', { hours })
  if (minutes > 0) return t('timeMinutes', { minutes })
  return t('justNow')
}

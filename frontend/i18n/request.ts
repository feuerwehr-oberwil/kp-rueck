import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isSupportedLocale, loadMessages } from '@/lib/i18n-messages'

export default getRequestConfig(async () => {
  const store = await cookies()
  const cookieLocale = store.get('NEXT_LOCALE')?.value
  const locale = isSupportedLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE

  return {
    locale,
    messages: loadMessages(locale),
  }
})

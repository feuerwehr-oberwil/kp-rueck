import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de.json'
import { queryWrapper } from './query-wrapper'

// Shared wrapper for components that call useTranslations or read the server through
// lib/query. German catalog only — de.json is the source of truth and tests pin the German
// strings intentionally. Each render gets its own query cache, so no test sees another's reads.
export function renderWithIntl(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  const QueryWrapper = queryWrapper()
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryWrapper>
        <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
          {children}
        </NextIntlClientProvider>
      </QueryWrapper>
    )
  }
  return render(ui, { wrapper: Providers, ...options })
}

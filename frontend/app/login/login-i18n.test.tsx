/**
 * The login page in French.
 *
 * Two things are worth a test here, and neither is covered by the catalogue
 * checks in `lib/i18n-messages.test.ts` — those prove the STRINGS exist, not
 * that this screen reaches them:
 *
 *   1. The page renders French end to end with no raw `login.page.*` key
 *      leaking through. Login is the one screen a Romand reader meets before
 *      they can change anything, so a missing key here is unrecoverable.
 *   2. The language switcher is present and writes the NEXT_LOCALE cookie.
 *      It only renders once a second locale is complete, which makes it a
 *      live assertion that French actually shipped.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de.json'
import { loadMessages } from '@/lib/i18n-messages'

// The expected strings come through loadMessages(), NOT from importing fr.json
// directly. That import types the assertions against whatever shape the file
// happens to have, so emptying the overlay turns this file into a wall of
// «Property 'login' does not exist on type '{}'» — a compile error about the
// test instead of a test failure about the app. Through the loader the types
// are German's either way, and an empty overlay fails honestly: the merged
// catalogue is German, so the "not German" assertion below trips.
const fr = loadMessages('fr')

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ login: vi.fn() }) }))
vi.mock('@/lib/contexts/event-context', () => ({
  useEvent: () => ({ setSelectedEvent: vi.fn() }),
  apiEventToEvent: (e: unknown) => e,
}))
vi.mock('@/lib/api-client', () => ({
  apiClient: { getDemoStatus: () => Promise.resolve({ demo: false }) },
}))
vi.mock('@/lib/auth-client', () => ({ getMicrosoftAuthConfig: () => Promise.resolve(null) }))

import LoginPage from './page'

const renderIn = (locale: 'de' | 'fr') =>
  render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <LoginPage />
    </NextIntlClientProvider>
  )

describe('login page in French', () => {
  beforeEach(() => {
    // getActiveLocale reads document.cookie; jsdom starts with none (= German).
    document.cookie = 'NEXT_LOCALE=fr; path=/'
  })
  afterEach(() => {
    document.cookie = 'NEXT_LOCALE=; path=/; max-age=0'
  })

  it('renders the French copy, not German and not raw keys', async () => {
    renderIn('fr')

    expect(await screen.findByText(fr.login.page.submit)).toBeInTheDocument()
    expect(screen.getByText(fr.login.page.subtitle)).toBeInTheDocument()
    // The German equivalents must be gone — a fallback here would be silent.
    expect(screen.queryByText(de.login.page.submit)).not.toBeInTheDocument()
    // next-intl renders `namespace.key` verbatim when a key is missing.
    expect(document.body.textContent).not.toMatch(/login\.page\./)
  })

  it('offers the language switcher and writes the locale cookie', async () => {
    renderIn('fr')

    const german = await screen.findByRole('button', { name: 'Deutsch' })
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-current', 'true')

    // jsdom has no navigation; reload would throw, and the assertion we care
    // about is the cookie the click writes.
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })

    await userEvent.click(german)
    await waitFor(() => expect(document.cookie).toContain('NEXT_LOCALE=de'))
    expect(reload).toHaveBeenCalled()
  })
})

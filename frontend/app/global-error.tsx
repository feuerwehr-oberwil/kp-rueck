'use client'

import { useEffect, useState } from 'react'

import {
  isDisplayRoute,
  readRetryAttempts,
  retryDelayFor,
  writeRetryAttempts,
} from '@/lib/utils/display-retry'

/**
 * Last-resort error boundary.
 *
 * `app/error.tsx` only wraps the PAGE segment — it never sees a throw from the
 * root layout itself, which is where every provider and global overlay lives
 * (AuthProvider … NotificationToasts, the GPS/vehicle prompts). Without this
 * file those errors fall through to Next's built-in fallback: an untranslated
 * "Application error" with no retry and no way home.
 *
 * Deliberately dependency-free: no next-intl, no design-system components, no
 * context. Whatever crashed the layout may well be the thing those depend on,
 * so this renders with inline styles and hard-coded German copy only.
 *
 * `reset()` re-renders the same tree, which is useless when the cause is
 * persisted client state (a corrupt localStorage value re-read on every
 * render). So the primary action is a hard reload, and there is a second
 * action that clears local browser state before reloading — the only in-app
 * escape from a poisoned-storage crash loop.
 *
 * On `/display/*` it ALSO reloads itself on the shared backoff. Wall displays
 * sit inside this same root layout, so a provider-level throw lands here
 * rather than in components/display-error.tsx — without this, the unattended
 * screen the auto-reload exists for could still dead-end on a static page.
 * Gated on the path deliberately: on a desktop, yanking the error away
 * mid-read (and out from under the "reset local data" button) is worse than
 * making the operator click.
 */

function clearLocalStateAndReload() {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Storage may itself be the thing that's broken (quota, disabled, locked
    // down by policy). Reloading is still worth a try.
  }
  window.location.reload()
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [autoReload] = useState(isDisplayRoute)
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    console.error('Global application error:', error)
  }, [error])

  useEffect(() => {
    if (!autoReload) return

    const attempt = readRetryAttempts()
    writeRetryAttempts(attempt + 1)
    const delayMs = retryDelayFor(attempt)
    setSecondsLeft(Math.round(delayMs / 1000))

    const tick = setInterval(() => {
      setSecondsLeft(prev => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    const reload = setTimeout(() => window.location.reload(), delayMs)

    return () => {
      clearInterval(tick)
      clearTimeout(reload)
    }
  }, [autoReload])

  const button: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '2.75rem',
    padding: '0 1.25rem',
    borderRadius: '0.5rem',
    border: '1px solid #3f3f46',
    background: '#18181b',
    color: '#fafafa',
    font: 'inherit',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
  }

  const primaryButton: React.CSSProperties = {
    ...button,
    background: '#dc2626',
    borderColor: '#dc2626',
    color: '#ffffff',
  }

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          background: '#09090b',
          color: '#fafafa',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: '30rem', textAlign: 'center' }}>
          <div
            style={{
              margin: '0 auto 1.5rem',
              width: '3.5rem',
              height: '3.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '0.75rem',
              background: 'rgba(220, 38, 38, 0.12)',
              border: '1px solid rgba(220, 38, 38, 0.25)',
              fontSize: '1.75rem',
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            ⚠
          </div>

          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', fontWeight: 700 }}>
            Die Anwendung ist abgestürzt
          </h1>
          <p style={{ margin: '0 0 1.75rem', color: '#a1a1aa', fontSize: '0.9375rem', lineHeight: 1.6 }}>
            {autoReload
              ? secondsLeft > 0
                ? `Automatischer Neustart in ${secondsLeft} s …`
                : 'Wird neu geladen …'
              : `KP Rück konnte nicht geladen werden. Zuerst neu laden. Bleibt der
                 Fehler nach dem Neuladen bestehen, lokale Daten zurücksetzen — dabei
                 gehen nur Einstellungen dieses Geräts verloren, keine Einsatzdaten.`}
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              justifyContent: 'center',
            }}
          >
            <button type="button" style={primaryButton} onClick={() => window.location.reload()}>
              Neu laden
            </button>
            <button type="button" style={button} onClick={clearLocalStateAndReload}>
              Lokale Daten zurücksetzen
            </button>
            <button type="button" style={button} onClick={() => reset()}>
              Erneut versuchen
            </button>
          </div>

          {error.digest && (
            <p style={{ margin: '1.75rem 0 0', color: '#52525b', fontSize: '0.75rem' }}>
              Fehler-ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}

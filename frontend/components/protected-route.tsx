'use client';

/**
 * Protected route wrapper
 * Redirects to login if user is not authenticated
 *
 * **This redirect is the role gate for the whole interactive app.** A `viewer` never
 * reaches the board, the map or the settings page — it is sent to `/display/board`, the
 * read-only wall view, which is what the shared/kiosk viewer account exists for
 * (`backend/app/seed.py`). Everyone who gets past here is an editor or an admin.
 *
 * Two consequences worth knowing before changing anything here:
 *
 * 1. The ~69 `isEditor` checks in `app/page.tsx`, `app/map/page.tsx` and
 *    `app/settings/page.tsx` are therefore **constant-true in practice** — their false
 *    branch is unreachable while this redirect stands. They were kept on purpose: they
 *    are what would make "let viewers open the real board read-only" a cheap change
 *    rather than a re-derivation. Do not read their presence as evidence that the
 *    controls are gated *here*.
 * 2. This is a convenience and UX guard, **not** the security boundary. The boundary is
 *    the backend: mutations require `CurrentEditor` and the admin surfaces require
 *    `CurrentAdmin`, so bypassing this redirect exposes no data — `GET /api/users` and
 *    `GET /api/audit` both refuse a viewer. Verified 2026-07-30.
 *
 * If you ever remove or weaken the redirect, those `isEditor` checks stop being
 * decoration and start being the thing that keeps the UI honest.
 */

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { checkBackendHealth } from '@/lib/auth-client';
import { useEffect, useState } from 'react';
import { BootScreen } from '@/components/boot-screen';
import { useBootGate, useLaunchCoverUp } from '@/lib/boot-cover';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const t = useTranslations('login.protectedRoute');
  const { user, loading } = useAuth();
  const router = useRouter();
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [checkingBackend, setCheckingBackend] = useState(false);
  const coverUp = useLaunchCoverUp();

  useEffect(() => {
    if (!loading && !user) {
      setCheckingBackend(true);
      checkBackendHealth().then((isHealthy) => {
        setBackendAvailable(isHealthy);
        setCheckingBackend(false);

        if (isHealthy) {
          router.push('/login');
        }
      });
    } else if (!loading && user?.role === 'viewer') {
      // Viewer accounts only ever see the read-only display board
      router.push('/display/board');
    }
  }, [user, loading, router]);

  // The launch cover (components/boot-cover.tsx) waits for the session before anything else:
  // decided means signed in as an editor, or the server-unreachable screen. Signed out and
  // viewers are on their way to another route, which lifts the cover by itself.
  useBootGate(
    'session',
    !loading && !checkingBackend && (user ? user.role !== 'viewer' : !backendAvailable),
    loading ? t('preparingLogin') : t('checkingServer'),
    0,
  );

  if (loading || checkingBackend) {
    // On a launch the cover already shows the snail and this phase, over everything.
    if (coverUp) return null;
    return (
      <BootScreen phase={loading ? t('preparingLogin') : t('checkingServer')} />
    );
  }

  // Backend is offline - show error
  if (!loading && !user && !backendAvailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="mb-4">
            <svg
              className="mx-auto h-12 w-12 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2">{t('serverUnreachableTitle')}</h2>
          <p className="text-muted-foreground mb-4">
            {t('serverUnreachableDescription')}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-action text-action-foreground rounded-md hover:bg-action/90"
          >
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!user) return null;
  // Redirecting viewers to /display/board — don't flash the editor board
  if (user.role === 'viewer') return null;

  return <>{children}</>;
}

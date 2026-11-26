'use client';

/**
 * Protected route wrapper
 * Redirects to login if user is not authenticated
 *
 * **This redirect is the role gate for the whole interactive app** (`lib/role-home.ts`). A
 * `viewer` on a phone may open the phone shell – the board, the Lagekarte, «Alle Ereignisse»
 * (owner pick 4A, phone sweep 24.11.2026) – and is sent to the phone board from every other
 * page. A viewer on anything wider never reaches the interactive app: it is sent to
 * `/display/board`, the read-only wall view the shared/kiosk viewer account exists for
 * (`backend/app/seeds/boot.py`). The gate follows the viewport: a phone turned past `md` goes to
 * the wall board.
 *
 * Two consequences worth knowing before changing anything here:
 *
 * 1. On the desk, the ~69 `isEditor` checks in `app/page.tsx`, `app/map/page.tsx` and
 *    `app/settings/page.tsx` are **constant-true** – their false branch never runs there.
 *    On the phone they are live: the phone shell's write controls are gated on `isEditor`,
 *    and `tests/e2e/07-viewer-role/phone-shell.spec.ts` holds that no viewer reaches one and
 *    that no write request leaves a phone viewer's session.
 * 2. This is a convenience and UX guard, **not** the security boundary. The boundary is
 *    the backend: mutations require `CurrentEditor` and the admin surfaces require
 *    `CurrentAdmin`, so bypassing this redirect exposes no data — `GET /api/users` and
 *    `GET /api/audit` both refuse a viewer. Verified 2026-07-30.
 *
 * Before opening another page to a viewer, gate its writes on `isEditor` and extend that spec.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { checkBackendHealth } from '@/lib/auth-client';
import { useEffect, useState } from 'react';
import { BootScreen } from '@/components/boot-screen';
import { useBootGate, useLaunchCoverUp } from '@/lib/boot-cover';
import { homeFor, mayOpen } from '@/lib/role-home';
import { isMobileViewport, useIsMobile } from '@/components/ui/use-mobile';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const t = useTranslations('login.protectedRoute');
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Render: may this user see this page? The redirect below asks the viewport itself –
  // the hydrating render answers «desktop» (`useIsMobile`), which must not bounce a phone.
  const isMobile = useIsMobile();
  const mayEnter = !!user && mayOpen(user.role, pathname, isMobile);
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
    } else if (!loading && user) {
      const phone = isMobileViewport();
      // A viewer off its pages: the phone board on a phone, the wall board anywhere wider
      if (!mayOpen(user.role, pathname, phone)) router.replace(homeFor(user.role, phone));
    }
    // `isMobile`: a phone turned past `md` (or a window widened) is asked again
  }, [user, loading, router, pathname, isMobile]);

  // The launch cover (components/boot-cover.tsx) waits for the session before anything else:
  // decided means signed in on a page this role may open, or the server-unreachable screen.
  // Signed out and bounced viewers are on their way to another route, which lifts the cover.
  useBootGate(
    'session',
    !loading && !checkingBackend && (user ? mayEnter : !backendAvailable),
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

  // Signed out, or a viewer on its way home — don't flash the page it may not open
  if (!mayEnter) return null;

  return <>{children}</>;
}

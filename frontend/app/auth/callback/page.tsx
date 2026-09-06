'use client';

/**
 * Microsoft Entra ID OAuth callback page.
 *
 * Receives the authorization code from Microsoft's redirect,
 * exchanges it via the backend, and redirects to the app.
 *
 * Calls microsoftLogin from auth-client directly (not through AuthContext)
 * to avoid re-renders that could cause the single-use auth code to be
 * redeemed twice. Uses window.location.href for a full page load so
 * AuthProvider picks up the cookie-based session cleanly.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { microsoftLogin } from '@/lib/auth-client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Flame } from 'lucide-react';

function CallbackProgress() {
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setProgress(20), 100);
    intervalRef.current = setInterval(() => {
      setProgress((prev) => (prev >= 85 ? prev : prev + Math.random() * 10));
    }, 500);
    return () => {
      clearTimeout(timer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return <Progress value={progress} className="h-1 mx-auto max-w-48" />;
}

export default function MicrosoftCallbackPage() {
  const t = useTranslations('login.callback');
  const searchParams = useSearchParams();
  const hasRun = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (errorParam) {
      setError(errorDescription || t('microsoftError', { error: errorParam }));
      return;
    }

    if (!code) {
      setError(t('noAuthCode'));
      return;
    }

    if (!state) {
      setError(t('microsoftLoginFailed'));
      return;
    }

    // Remove credentials from the browser history before redeeming them.
    window.history.replaceState(null, '', window.location.pathname);
    microsoftLogin(code, state)
      .then((user) => {
        window.location.href = user.role === 'viewer' ? '/display/board' : '/';
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('microsoftLoginFailed'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.03] via-transparent to-transparent" />
      <div className="relative w-full max-w-sm">
        <Card className="border border-border bg-card/80 backdrop-blur-sm overflow-hidden">
          <div className="p-8 text-center">
            {error ? (
              <>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-destructive/10 border border-destructive/20">
                  <Flame className="h-7 w-7 text-destructive" strokeWidth={1.5} />
                </div>
                <div className="mb-1 text-base font-semibold text-foreground">{t('loginFailed')}</div>
                <p className="mb-6 text-sm text-muted-foreground">{error}</p>
                <Button asChild variant="outline" className="w-full">
                  <a href="/login">{t('backToLogin')}</a>
                </Button>
              </>
            ) : (
              <>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                  <Flame className="h-7 w-7 text-primary" strokeWidth={1.5} />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1">KP Rück</h1>
                <p className="text-sm text-muted-foreground mb-6">{t('processing')}</p>
                <CallbackProgress />
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

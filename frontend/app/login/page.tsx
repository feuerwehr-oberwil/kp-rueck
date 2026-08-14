'use client';

/**
 * Login page
 * Allows users to authenticate with username and password.
 * If Microsoft Entra ID is configured, shows "Login with Microsoft" as primary option.
 * In demo mode, shows quick-login buttons for demo accounts.
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEvent, apiEventToEvent } from '@/lib/contexts/event-context';
import { apiClient } from '@/lib/api-client';
import { getMicrosoftAuthConfig, MicrosoftAuthConfig } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Loader2, LogIn, Shield, Eye, Flame } from 'lucide-react';
import {
  AVAILABLE_LOCALES,
  LOCALE_NAMES,
  getActiveLocale,
  setActiveLocale,
  type SupportedLocale,
} from '@/lib/i18n-messages';

export default function LoginPage() {
  const t = useTranslations('login.page');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDemo, setIsDemo] = useState<boolean | null>(null);
  const [msConfig, setMsConfig] = useState<MicrosoftAuthConfig | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The locale lives in a cookie the server never sees on this route, so the
  // switcher can only be rendered after mount – otherwise the server marks DE
  // active and the client disagrees.
  const [mounted, setMounted] = useState(false);
  const { login } = useAuth();
  const { setSelectedEvent } = useEvent();
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    Promise.all([
      apiClient.getDemoStatus().then((status) => {
        setIsDemo(status?.demo ?? false);
      }).catch(() => {
        setIsDemo(false);
      }),
      getMicrosoftAuthConfig().then(setMsConfig),
    ]).finally(() => setConfigLoading(false));
  }, []);

  // Simulate progress during login
  useEffect(() => {
    if (loading) {
      setProgress(0);
      // Quick initial jump, then slow crawl
      const timer = setTimeout(() => setProgress(30), 100);
      progressRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 85) return prev;
          return prev + Math.random() * 8;
        });
      }, 400);
      return () => {
        clearTimeout(timer);
        if (progressRef.current) clearInterval(progressRef.current);
      };
    } else {
      // Complete the bar briefly before resetting
      if (progress > 0) {
        setProgress(100);
        const timer = setTimeout(() => setProgress(0), 300);
        return () => clearTimeout(timer);
      }
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const loggedInUser = await login(username, password);
      // Viewer-role accounts get the read-only display board (kiosk/shared PCs)
      router.push(loggedInUser.role === 'viewer' ? '/display/board' : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (role: 'editor' | 'viewer') => {
    setError('');
    setLoading(true);
    const demoUsername = role === 'editor' ? 'demo-editor' : 'demo-viewer';

    try {
      await login(demoUsername, 'demo123');

      // Every demo visitor — editor and viewer — gets their own sandbox event
      // so simultaneous visitors don't share a board and nobody lands on a
      // generic base event. Best-effort: any failure falls back to the normal
      // post-login flow.
      try {
        const sandbox = await apiClient.createDemoSandbox();
        const apiEvent = await apiClient.getEvent(sandbox.event_id, { skipToast: true });
        setSelectedEvent(apiEventToEvent(apiEvent));
      } catch (sandboxErr) {
        console.warn('Demo-Sandbox konnte nicht erstellt werden:', sandboxErr);
      }

      router.push(role === 'viewer' ? '/display/board' : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('demoLoginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = () => {
    if (!msConfig) return;

    const params = new URLSearchParams({
      client_id: msConfig.client_id,
      response_type: 'code',
      redirect_uri: msConfig.redirect_uri,
      scope: 'openid profile email',
      response_mode: 'query',
    });

    window.location.href = `https://login.microsoftonline.com/${msConfig.tenant_id}/oauth2/v2.0/authorize?${params.toString()}`;
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      {/* Subtle background pattern */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.03] via-transparent to-transparent" />

      <div className="relative w-full max-w-sm">
        {/* Progress bar — pinned above card */}
        <div className={cn(
          'absolute -top-1 left-0 right-0 z-10 transition-opacity duration-200',
          loading ? 'opacity-100' : 'opacity-0'
        )}>
          <Progress value={progress} className="h-1 rounded-t-xl rounded-b-none" />
        </div>

        <Card className="border border-border bg-card/80 backdrop-blur-sm overflow-hidden">
          <div className="p-8">
            {/* Header */}
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                <Flame className="h-7 w-7 text-primary" strokeWidth={1.5} />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                KP Rück
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {t('subtitle')}
              </p>
              {isDemo && (
                <span className="mt-2 inline-block rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning-foreground border border-warning/30">
                  {t('demoBadge')}
                </span>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Loading config skeleton */}
            {configLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Demo mode */}
            {!configLoading && isDemo === true && (
              <div className="space-y-3">
                <Button
                  className="w-full"
                  onClick={() => handleDemoLogin('editor')}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Shield className="size-4" />
                  )}
                  {t('loginAsEditor')}
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => handleDemoLogin('viewer')}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  {t('loginAsViewer')}
                </Button>
              </div>
            )}

            {/* Normal mode */}
            {!configLoading && isDemo === false && (
              <div className="space-y-6">
                {/* Microsoft Login */}
                {msConfig && (
                  <Button
                    className="w-full"
                    onClick={handleMicrosoftLogin}
                    disabled={loading}
                  >
                    <svg className="size-4" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                      <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                      <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                    </svg>
                    {t('loginWithMicrosoft')}
                  </Button>
                )}

                {/* Password form toggle / form */}
                {msConfig && !showPasswordForm ? (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center">
                      <button
                        type="button"
                        className="bg-card px-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setShowPasswordForm(true)}
                      >
                        {t('loginWithPassword')}
                      </button>
                    </div>
                  </div>
                ) : (!msConfig || showPasswordForm) && (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {msConfig && (
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">{t('or')}</span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="username" className="text-sm font-semibold text-muted-foreground">
                          {t('usernameLabel')}
                        </Label>
                        <Input
                          id="username"
                          type="text"
                          placeholder={t('usernamePlaceholder')}
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          required
                          autoComplete="username"
                          autoFocus={!msConfig}
                          disabled={loading}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password" className="text-sm font-semibold text-muted-foreground">
                          {t('passwordLabel')}
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder={t('passwordPlaceholder')}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                          disabled={loading}
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      variant={msConfig ? 'outline' : 'default'}
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <LogIn className="size-4" />
                      )}
                      {loading ? t('loggingIn') : t('submit')}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Language switcher. It belongs BEFORE the login, not only in Settings:
            a reader from the Romandie meets this page first, and a picker that
            sits behind a login they cannot read is no picker at all. Same rule
            as Settings – it appears only once a second locale is complete. */}
        {mounted && AVAILABLE_LOCALES.length > 1 && (
          <div className="mt-6 flex items-center justify-center gap-1">
            {AVAILABLE_LOCALES.map((locale) => {
              const active = locale === getActiveLocale();
              return (
                <button
                  key={locale}
                  type="button"
                  lang={locale}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    if (active) return;
                    setActiveLocale(locale as SupportedLocale);
                    // Full reload, like Settings: server components and the
                    // out-of-React translators read the cookie at load time.
                    window.location.reload();
                  }}
                  className={cn(
                    'rounded-md px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors',
                    active
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {LOCALE_NAMES[locale]}
                </button>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

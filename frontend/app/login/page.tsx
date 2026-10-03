'use client';

/**
 * Login page
 * Allows users to authenticate with username and password.
 * If Microsoft Entra ID is configured, shows "Login with Microsoft" as primary option.
 * In demo mode, shows quick-login buttons for demo accounts.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEvent, apiEventToEvent } from '@/lib/contexts/event-context';
import { apiClient } from '@/lib/api-client';
import { getMicrosoftAuthConfig, startMicrosoftLogin, MicrosoftAuthConfig } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { LogIn, Shield, Eye, Flame } from 'lucide-react';
import {
  AVAILABLE_LOCALES,
  LOCALE_NAMES,
  getActiveLocale,
  setActiveLocale,
  type SupportedLocale,
} from '@/lib/i18n-messages';
import { ShellLoader, LoadingStatus } from '@/components/ui/shell-loader';
import { launchCover, useBootGate } from '@/lib/boot-cover';

export default function LoginPage() {
  const t = useTranslations('login.page');
  const tLoading = useTranslations('common');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Which way in is running. The busy button shows the shell trail and «Wird angemeldet …»;
  // the others are disabled. This replaced a progress bar above the card that crept up by
  // Math.random() to 85 % – a number that measured nothing (the request has no progress).
  const [pending, setPending] = useState<'form' | 'editor' | 'viewer' | 'microsoft' | null>(null);
  const loading = pending !== null;
  const [isDemo, setIsDemo] = useState<boolean | null>(null);
  const [msConfig, setMsConfig] = useState<MicrosoftAuthConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  // On a launch onto /login the boot cover stays up until the sign-in options are known, so
  // the form appears complete instead of behind a loader of its own.
  useBootGate('login', !configLoading);
  // The locale lives in a cookie the server never sees on this route, so the
  // switcher can only be rendered after mount – otherwise the server marks DE
  // active and the client disagrees.
  const [mounted, setMounted] = useState(false);
  const { login } = useAuth();
  const { setSelectedEvent } = useEvent();
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // An unclaimed board has no accounts to log into — the first visit belongs
    // to the setup wizard. Checked only when this page mounts (not on every app
    // boot), and failing open: an unreachable backend keeps this a login page.
    apiClient.getSetupStatus().then((status) => {
      if (status && !status.claimed) {
        router.replace('/setup');
      }
    });
  }, [router]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPending('form');

    try {
      const loggedInUser = await login(username, password);
      // Signed in: what follows is a launch — the snail covers until the workspace is usable.
      launchCover.arm(window.location.pathname);
      // Viewer-role accounts get the read-only display board (kiosk/shared PCs)
      router.push(loggedInUser.role === 'viewer' ? '/display/board' : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    } finally {
      setPending(null);
    }
  };

  const handleDemoLogin = async (role: 'editor' | 'viewer') => {
    setError('');
    setPending(role);
    const demoUsername = role === 'editor' ? 'demo-editor' : 'demo-viewer';

    try {
      await login(demoUsername, 'demo123');
      launchCover.arm(window.location.pathname);

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
      setPending(null);
    }
  };

  const handleMicrosoftLogin = async () => {
    if (!msConfig) return;
    setError('');
    setPending('microsoft');
    try {
      window.location.href = await startMicrosoftLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
      setPending(null);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      {/* Subtle background pattern */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.03] via-transparent to-transparent" />

      <div className="relative w-full max-w-sm">
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

            {/* Sign-in options still loading */}
            {configLoading && (
              <div className="flex items-center justify-center py-8">
                <LoadingStatus className="text-sm">{tLoading('loading')}</LoadingStatus>
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
                  {pending === 'editor' ? (
                    <ShellLoader className="size-4" />
                  ) : (
                    <Shield className="size-4" />
                  )}
                  {pending === 'editor' ? t('loggingIn') : t('loginAsEditor')}
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => handleDemoLogin('viewer')}
                  disabled={loading}
                >
                  {pending === 'viewer' ? (
                    <ShellLoader className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  {pending === 'viewer' ? t('loggingIn') : t('loginAsViewer')}
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
                    {pending === 'microsoft' ? (
                      <ShellLoader className="size-4" />
                    ) : (
                      <svg className="size-4" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                        <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                        <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                        <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                      </svg>
                    )}
                    {pending === 'microsoft' ? t('loggingIn') : t('loginWithMicrosoft')}
                  </Button>
                )}

                {/* Both ways in, always both visible. The password form used to hide
                    behind a «Mit Passwort anmelden» link, which cost a click on every
                    single login for the accounts that have no Entra ID — the Magazin
                    display, the shared editor account, anyone during an outage of the
                    identity provider. A login screen is not the place to save two rows
                    of height at the cost of a step. */}
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
                      {pending === 'form' ? (
                        <ShellLoader className="size-4" />
                      ) : (
                        <LogIn className="size-4" />
                      )}
                      {pending === 'form' ? t('loggingIn') : t('submit')}
                    </Button>
                  </form>
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

'use client';

/**
 * First-run setup wizard
 * Shown once, on a freshly installed board that no station has claimed yet.
 * Two inputs (station name + admin password) create the admin account; the
 * page then logs in as that admin and lands on the board. Once claimed the
 * page only ever redirects to `/` — everything else lives in Settings, and
 * the config-file path is documented in docs/SETUP.md.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { apiClient, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, Eye, EyeOff } from 'lucide-react';

export default function SetupPage() {
  const t = useTranslations('setup.page');
  const [stationName, setStationName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldError, setFieldError] = useState<'tooShort' | 'mismatch' | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // null = status check still running (spinner); 409 after submit flips this
  // to true as well — same end state, reached one step later.
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const { login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // A claimed board has no setup page: back to `/`, which lands on login.
    // Unreachable backend (null) fails open into the form — the submit will
    // fail honestly if the server really is down.
    apiClient.getSetupStatus().then((status) => {
      if (status?.claimed) {
        router.replace('/');
      } else {
        setClaimed(false);
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (password.length < 12) {
      setFieldError('tooShort');
      return;
    }
    if (password !== passwordRepeat) {
      setFieldError('mismatch');
      return;
    }
    setFieldError(null);
    setSubmitting(true);

    try {
      const result = await apiClient.claimSetup({
        station_name: stationName.trim(),
        admin_password: password,
      });
      // The claim created the admin account — sign in with it right away so
      // the operator lands on their board, not on a login form. If the login
      // itself fails, `/` shows the login page and the password still works.
      try {
        await login(result.username, password);
      } catch {
        // fall through to the hard navigation below
      }
      // Hard navigation on purpose: the app boot re-reads auth and settings
      // from a clean slate on the freshly claimed board.
      window.location.assign('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setClaimed(true);
      } else {
        setSubmitError(err instanceof Error && err.message ? err.message : t('errorGeneric'));
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      {/* Subtle background pattern — same stage as the login page */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.03] via-transparent to-transparent" />

      <div className="relative w-full max-w-sm">
        <Card className="border border-border bg-card/80 backdrop-blur-sm overflow-hidden">
          <div className="p-8">
            {/* Logo mark */}
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary text-[15px] font-bold tracking-tight text-primary-foreground">
              KP
            </div>

            {claimed === null && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {claimed === true && (
              <>
                <h1 className="text-lg font-semibold text-foreground">{t('alreadyClaimedTitle')}</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t('alreadyClaimedBody')}</p>
                <Button className="w-full" onClick={() => router.push('/login')}>
                  {t('goToLogin')}
                </Button>
              </>
            )}

            {claimed === false && (
              <>
                <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t('subtitle')}</p>

                {submitError && (
                  <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm text-destructive">{submitError}</p>
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="station-name" className="text-sm font-semibold text-muted-foreground">
                      {t('stationNameLabel')}
                    </Label>
                    <Input
                      id="station-name"
                      type="text"
                      placeholder={t('stationNamePlaceholder')}
                      value={stationName}
                      onChange={(e) => setStationName(e.target.value)}
                      required
                      autoFocus
                      disabled={submitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-password" className="text-sm font-semibold text-muted-foreground">
                      {t('passwordLabel')}{' '}
                      <span className="font-normal text-muted-foreground">– {t('passwordHint')}</span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="admin-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        disabled={submitting}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <EyeOff className="size-4 text-muted-foreground" />
                        ) : (
                          <Eye className="size-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    {fieldError === 'tooShort' && (
                      <p className="text-sm text-destructive">{t('errorTooShort')}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-password-repeat" className="text-sm font-semibold text-muted-foreground">
                      {t('passwordRepeatLabel')}
                    </Label>
                    <Input
                      id="admin-password-repeat"
                      type={showPassword ? 'text' : 'password'}
                      value={passwordRepeat}
                      onChange={(e) => setPasswordRepeat(e.target.value)}
                      required
                      autoComplete="new-password"
                      disabled={submitting}
                    />
                    {fieldError === 'mismatch' && (
                      <p className="text-sm text-destructive">{t('errorMismatch')}</p>
                    )}
                  </div>

                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting && <Loader2 className="size-4 animate-spin" />}
                    {submitting ? t('submitting') : t('submit')}
                  </Button>
                </form>

                <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
                  {t.rich('footer', {
                    code: (chunks) => (
                      <code className="font-mono text-[11px] text-foreground">{chunks}</code>
                    ),
                  })}
                </p>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

'use client';

/**
 * Login page
 * Allows users to authenticate with username and password.
 * If Microsoft Entra ID is configured, shows "Login with Microsoft" as primary option.
 * In demo mode, shows quick-login buttons for demo accounts.
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { getMicrosoftAuthConfig, MicrosoftAuthConfig } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Loader2, LogIn, Shield, Eye, Flame } from 'lucide-react';

export default function LoginPage() {
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
  const { login } = useAuth();
  const router = useRouter();

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
      await login(username, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen. Bitte überprüfen Sie Benutzername und Passwort.');
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
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo-Anmeldung fehlgeschlagen.');
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

        <Card className="border border-border/50 bg-card/80 backdrop-blur-sm shadow-lg overflow-hidden">
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
                Einsatz-Dashboard
              </p>
              {isDemo && (
                <span className="mt-2 inline-block rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning border border-warning/30">
                  Demo-Modus
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
                  className="w-full h-11"
                  onClick={() => handleDemoLogin('editor')}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Shield className="mr-2 h-4 w-4" />
                  )}
                  Als Editor einloggen
                </Button>
                <Button
                  className="w-full h-11"
                  variant="outline"
                  onClick={() => handleDemoLogin('viewer')}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  Als Betrachter einloggen
                </Button>
              </div>
            )}

            {/* Normal mode */}
            {!configLoading && isDemo === false && (
              <div className="space-y-6">
                {/* Microsoft Login */}
                {msConfig && (
                  <Button
                    className="w-full h-11"
                    onClick={handleMicrosoftLogin}
                    disabled={loading}
                  >
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                      <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                      <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                    </svg>
                    Mit Microsoft anmelden
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
                        Mit Passwort anmelden
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
                          <span className="bg-card px-2 text-muted-foreground">oder</span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="username" className="text-sm font-medium text-muted-foreground">
                          Benutzername
                        </Label>
                        <Input
                          id="username"
                          type="text"
                          placeholder="Benutzername"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          required
                          autoComplete="username"
                          autoFocus={!msConfig}
                          disabled={loading}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password" className="text-sm font-medium text-muted-foreground">
                          Passwort
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="Passwort"
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
                      className="w-full h-11"
                      variant={msConfig ? 'outline' : 'default'}
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <LogIn className="mr-2 h-4 w-4" />
                      )}
                      {loading ? 'Wird angemeldet...' : 'Anmelden'}
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}

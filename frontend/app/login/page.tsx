'use client';

/**
 * Login page
 * Allows users to authenticate with username and password.
 * If Microsoft Entra ID is configured, shows "Login with Microsoft" as primary option.
 * In demo mode, shows quick-login buttons for demo accounts.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { getMicrosoftAuthConfig, MicrosoftAuthConfig } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDemo, setIsDemo] = useState<boolean | null>(null);
  const [msConfig, setMsConfig] = useState<MicrosoftAuthConfig | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    apiClient.getDemoStatus().then((status) => {
      setIsDemo(status?.demo ?? false);
    }).catch(() => {
      setIsDemo(false);
    });

    getMicrosoftAuthConfig().then(setMsConfig);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen. Bitte überprüfen Sie Ihre Anmeldedaten.');
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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md border border-border/50 bg-card/80 backdrop-blur-sm p-8 shadow-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-4xl shadow-lg">
            🚒
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            KP Rück
          </h1>
          {isDemo && (
            <span className="mt-2 inline-block rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-500 border border-amber-500/30">
              Demo-Modus
            </span>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            Anmelden für Zugriff auf das Einsatz-Dashboard
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {isDemo === true && (
          <div className="mb-6 space-y-3">
            <Button
              className="w-full"
              size="lg"
              onClick={() => handleDemoLogin('editor')}
              disabled={loading}
            >
              Als Editor einloggen
            </Button>
            <Button
              className="w-full"
              size="lg"
              variant="outline"
              onClick={() => handleDemoLogin('viewer')}
              disabled={loading}
            >
              Als Betrachter einloggen
            </Button>
          </div>
        )}

        {isDemo === false && (
          <div className="space-y-6">
            {/* Microsoft Login Button (only shown when configured) */}
            {msConfig && (
              <>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleMicrosoftLogin}
                  disabled={loading}
                >
                  <svg className="mr-2 h-5 w-5" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                  </svg>
                  Mit Microsoft anmelden
                </Button>

              </>
            )}

            {/* Password form: always shown when no MS config, toggled when MS is available */}
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
              <form onSubmit={handleSubmit} className="space-y-6">
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
                  <div>
                    <Label htmlFor="username" className="text-sm font-semibold text-muted-foreground">
                      Benutzername
                    </Label>
                    <Input
                      id="username"
                      type="text"
                      placeholder="Benutzername eingeben"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoComplete="username"
                      autoFocus={!msConfig}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="password" className="text-sm font-semibold text-muted-foreground">
                      Passwort
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Passwort eingeben"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="mt-2"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  variant={msConfig ? 'outline' : 'default'}
                  disabled={loading}
                >
                  {loading ? 'Wird angemeldet...' : 'Anmelden'}
                </Button>
              </form>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

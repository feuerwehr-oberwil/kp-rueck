'use client';

/**
 * Login page
 * Allows users to authenticate with username and password.
 * In demo mode, shows quick-login buttons for demo accounts.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    apiClient.getDemoStatus().then((status) => {
      if (status?.demo) setIsDemo(true);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      router.push('/');  // Redirect to home page with welcome screen
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

        {isDemo && (
          <div className="mb-6 space-y-3">
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
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

        {!isDemo && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <p className="text-sm text-destructive">{error}</p>
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
                  autoFocus
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
              disabled={loading}
            >
              {loading ? 'Wird angemeldet...' : 'Anmelden'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

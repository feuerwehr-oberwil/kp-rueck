'use client';

/**
 * Login page
 * Allows users to authenticate with username and password
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/api-client';
import { Info } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDevelopment, setIsDevelopment] = useState(false);
  const [envLoading, setEnvLoading] = useState(true);
  const { login } = useAuth();
  const router = useRouter();

  // Check environment on mount
  useEffect(() => {
    const checkEnvironment = async () => {
      try {
        const envInfo = await apiClient.getEnvironmentInfo();
        setIsDevelopment(envInfo.is_development);
      } catch (err) {
        console.error('Failed to fetch environment info:', err);
        // Assume production if fetch fails
        setIsDevelopment(false);
      } finally {
        setEnvLoading(false);
      }
    };

    checkEnvironment();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      router.push('/events');  // Redirect to event selection
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen. Bitte überprüfen Sie Ihre Anmeldedaten.');
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
          <p className="mt-2 text-sm text-muted-foreground">
            Anmelden für Zugriff auf das Einsatz-Dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!envLoading && isDevelopment && (
            <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    Entwicklungsmodus
                  </p>
                  <p className="text-blue-700 dark:text-blue-300">
                    Verwenden Sie <span className="font-mono font-bold">admin</span> / <span className="font-mono font-bold">admin</span> für den Zugriff.
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                    ⚠️ Dies ist nur für lokale Entwicklung gedacht!
                  </p>
                </div>
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
      </Card>
    </div>
  );
}

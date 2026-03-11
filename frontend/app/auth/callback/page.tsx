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
import { microsoftLogin } from '@/lib/auth-client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function MicrosoftCallbackPage() {
  const searchParams = useSearchParams();
  const hasRun = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (errorParam) {
      setError(errorDescription || `Microsoft-Fehler: ${errorParam}`);
      return;
    }

    if (!code) {
      setError('Kein Autorisierungscode erhalten');
      return;
    }

    microsoftLogin(code)
      .then(() => {
        window.location.href = '/';
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Microsoft-Anmeldung fehlgeschlagen');
      });
  }, [searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md border border-border/50 bg-card/80 backdrop-blur-sm p-8 shadow-lg text-center">
        {error ? (
          <>
            <div className="mb-4 text-destructive font-semibold">Anmeldung fehlgeschlagen</div>
            <p className="mb-6 text-sm text-muted-foreground">{error}</p>
            <Button asChild variant="outline">
              <a href="/login">Zurück zur Anmeldung</a>
            </Button>
          </>
        ) : (
          <>
            <div className="mb-4 animate-spin mx-auto h-8 w-8 rounded-full border-2 border-muted-foreground border-t-foreground" />
            <p className="text-sm text-muted-foreground">Anmeldung wird verarbeitet...</p>
          </>
        )}
      </Card>
    </div>
  );
}

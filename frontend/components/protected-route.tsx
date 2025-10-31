'use client';

/**
 * Protected route wrapper
 * Redirects to login if user is not authenticated
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { checkBackendHealth } from '@/lib/auth-client';
import { useEffect, useState } from 'react';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [checkingBackend, setCheckingBackend] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      // Check if backend is available before redirecting to login
      setCheckingBackend(true);
      checkBackendHealth().then((isHealthy) => {
        setBackendAvailable(isHealthy);
        setCheckingBackend(false);

        if (isHealthy) {
          // Backend is healthy, user just isn't logged in
          router.push('/login');
        }
      });
    }
  }, [user, loading, router]);

  if (loading || checkingBackend) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
            <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
              Lädt...
            </span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {loading ? 'Prüfe Anmeldung...' : 'Prüfe Serververbindung...'}
          </p>
        </div>
      </div>
    );
  }

  // Backend is offline - show error
  if (!loading && !user && !backendAvailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="mb-4">
            <svg
              className="mx-auto h-12 w-12 text-red-500"
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
          <h2 className="text-xl font-bold mb-2">Server nicht erreichbar</h2>
          <p className="text-muted-foreground mb-4">
            Der Backend-Server ist momentan nicht verfügbar. Bitte stellen Sie sicher, dass der Server läuft.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}

/**
 * Protected route that requires editor role
 * Redirects to home if user is not an editor
 */
export function EditorRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isEditor } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    } else if (!loading && user && !isEditor) {
      router.push('/');
    }
  }, [user, loading, isEditor, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
            <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
              Lädt...
            </span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Lädt...</p>
        </div>
      </div>
    );
  }

  if (!user || !isEditor) return null;

  return <>{children}</>;
}

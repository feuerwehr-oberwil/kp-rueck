'use client';

/**
 * Protected route wrapper
 * Redirects to login if user is not authenticated
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { checkBackendHealth } from '@/lib/auth-client';
import { useEffect, useState, useRef } from 'react';
import { Progress } from '@/components/ui/progress';
import { Flame } from 'lucide-react';

function AuthLoadingScreen({ message }: { message: string }) {
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setProgress(20), 100);
    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) return prev;
        return prev + Math.random() * 10;
      });
    }, 500);
    return () => {
      clearTimeout(timer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
          <Flame className="h-7 w-7 text-primary" strokeWidth={1.5} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1">KP Rück</h1>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <Progress value={progress} className="h-1 mx-auto max-w-48" />
      </div>
    </div>
  );
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [checkingBackend, setCheckingBackend] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      setCheckingBackend(true);
      checkBackendHealth().then((isHealthy) => {
        setBackendAvailable(isHealthy);
        setCheckingBackend(false);

        if (isHealthy) {
          router.push('/login');
        }
      });
    }
  }, [user, loading, router]);

  if (loading || checkingBackend) {
    return (
      <AuthLoadingScreen
        message={loading ? 'Anmeldung wird vorbereitet...' : 'Prüfe Serververbindung...'}
      />
    );
  }

  // Backend is offline - show error
  if (!loading && !user && !backendAvailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="mb-4">
            <svg
              className="mx-auto h-12 w-12 text-destructive"
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
    return <AuthLoadingScreen message="Anmeldung wird vorbereitet..." />;
  }

  if (!user || !isEditor) return null;

  return <>{children}</>;
}

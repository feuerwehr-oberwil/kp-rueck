'use client';

/**
 * Protected route wrapper
 * Redirects to login if user is not authenticated
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEffect } from 'react';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

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

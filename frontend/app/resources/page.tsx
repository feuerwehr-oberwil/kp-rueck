'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect page - Resources have been merged into Settings
 */
export default function ResourcesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings?section=personnel');
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground">Weiterleitung...</p>
    </div>
  );
}

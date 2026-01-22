'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect page - Import/Export has been merged into Settings
 */
export default function ImportRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings?section=import');
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground">Weiterleitung...</p>
    </div>
  );
}

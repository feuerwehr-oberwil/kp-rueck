'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect page - Audit logs have been merged into Settings
 */
export default function AuditRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings?section=audit');
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground">Weiterleitung...</p>
    </div>
  );
}

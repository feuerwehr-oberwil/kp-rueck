'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

/**
 * Redirect page - Audit logs have been merged into Settings
 */
export default function AuditRedirect() {
  const router = useRouter();
  const t = useTranslations('common');

  useEffect(() => {
    router.replace('/settings?section=audit');
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">{t('redirecting')}</p>
    </div>
  );
}

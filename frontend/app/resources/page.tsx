'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

/**
 * Redirect page - Resources have been merged into Settings
 */
export default function ResourcesRedirect() {
  const router = useRouter();
  const t = useTranslations('common');

  useEffect(() => {
    router.replace('/settings?section=personnel');
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-muted-foreground">{t('redirecting')}</p>
    </div>
  );
}

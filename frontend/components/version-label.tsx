'use client';

import { useTranslations } from 'next-intl';
import { buildLabel } from '@/lib/build-info';
import { cn } from '@/lib/utils';

/** «Version v0.7.0 · 1a2b3c4 · 03.10.2026» — the one version line (menu, Mehr, help). */
export function VersionLabel({ className }: { className?: string }) {
  const t = useTranslations('nav.account');
  const label = buildLabel();
  return (
    // The bare label («v0.7.0 · …») fits the menu on one line; the word is in the name.
    <p
      className={cn('select-text truncate text-xs tabular-nums text-muted-foreground', className)}
      title={t('versionHint')}
      aria-label={t('version', { label })}
    >
      {label}
    </p>
  );
}

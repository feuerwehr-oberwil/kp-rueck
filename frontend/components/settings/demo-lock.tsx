'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * Wraps a block of settings so it stays fully visible but becomes read-only in
 * demo mode. The shared demo database is used by every visitor at once, so any
 * control that writes server state must not be editable — otherwise one visitor
 * changes it for everyone.
 *
 * A disabled <fieldset> natively disables every form control it contains
 * (inputs, buttons, Radix switches/selects/checkboxes all render native
 * <button>/<input>), so we don't have to thread a demo flag through every
 * control. The wrapper carries a title so hovering the locked area explains why
 * it can't be edited.
 */
export function DemoLock({
  active,
  children,
  className,
}: {
  active: boolean;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations('settings');
  if (!active) return <>{children}</>;
  return (
    <div title={t('page.demo.locked')} className={cn('cursor-not-allowed', className)}>
      <fieldset disabled className="m-0 min-w-0 border-0 p-0">
        {children}
      </fieldset>
    </div>
  );
}

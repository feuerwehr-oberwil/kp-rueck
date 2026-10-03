'use client';

/**
 * Who is logged in — ONE block for the desktop user menu and the phone Mehr sheet.
 *
 * It used to be the login name plus the role badge on the desktop and the badge alone on the
 * phone (in the sheet's title, far from «Abmelden»). Now both read the same: the display name
 * (the login name when there is none, or beside it when they differ) and the role badge.
 */

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { RoleBadge } from '@/components/auth/role-badge';
import { cn } from '@/lib/utils';

export function AccountBlock({ className }: { className?: string }) {
  const { user } = useAuth();
  const t = useTranslations('nav.account');
  if (!user) return null;
  const name = user.display_name?.trim() || user.username;
  const showLogin = name !== user.username;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} aria-label={t('signedInAs', { name })}>
      <p className="truncate text-sm font-medium leading-none" title={name}>
        {name}
        {showLogin && <span className="ml-1.5 text-xs font-normal text-muted-foreground">@{user.username}</span>}
      </p>
      <div>
        <RoleBadge />
      </div>
    </div>
  );
}

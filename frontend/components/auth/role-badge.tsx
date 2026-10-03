'use client';

/**
 * Role Badge Component
 * Displays the current user's role (Admin/Bearbeiter/Betrachter) in the navigation
 * Always visible to inform users of their permission level
 *
 * Always with its word, in the neutral badge. On the phone it used to be the icon alone in the
 * `default` variant – i.e. a red pill with a shield under «Weitere Funktionen» that nobody could
 * read (owner, 02.10.2026). Red is priority and danger only; a role is neither.
 */

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { Badge } from '@/components/ui/badge';
import { Eye, Shield } from 'lucide-react';

export function RoleBadge() {
  const { user, isEditor } = useAuth();
  const t = useTranslations('settings.users.roles');

  // Don't show badge if no user is logged in
  if (!user) {
    return null;
  }

  const role = user.role === 'admin' ? 'admin' : isEditor ? 'editor' : 'viewer';
  const RoleIcon = isEditor ? Shield : Eye;

  return (
    <Badge variant="secondary" className="gap-1.5">
      <RoleIcon className="h-3 w-3" aria-hidden="true" />
      <span>{t(role)}</span>
    </Badge>
  );
}

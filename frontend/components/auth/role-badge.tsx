'use client';

/**
 * Role Badge Component
 * Displays the current user's role (Editor/Viewer) in the navigation
 * Always visible to inform users of their permission level
 */

import { useAuth } from '@/lib/contexts/auth-context';
import { Badge } from '@/components/ui/badge';
import { Eye, Shield } from 'lucide-react';

export function RoleBadge() {
  const { user, isEditor } = useAuth();

  // Don't show badge if no user is logged in
  if (!user) {
    return null;
  }

  const roleName = isEditor ? 'Editor' : 'Viewer';
  const RoleIcon = isEditor ? Shield : Eye;

  return (
    <Badge
      variant={isEditor ? 'default' : 'secondary'}
      className="gap-1.5"
    >
      <RoleIcon className="h-3 w-3" />
      {/* Show text on desktop, icon-only on mobile */}
      <span className="hidden sm:inline-block">{roleName}</span>
    </Badge>
  );
}

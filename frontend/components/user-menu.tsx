'use client';

/**
 * User menu component
 * Displays current user info and logout button
 */

import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function UserMenu() {
  const { user, logout, isEditor, isAuthenticated } = useAuth();
  const router = useRouter();

  if (!isAuthenticated || !user) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  return (
    <div className="flex items-center gap-4">
      <div className="text-sm">
        <div className="font-medium text-foreground">{user.username}</div>
        <div className="text-muted-foreground">
          {isEditor ? 'Editor' : 'Betrachter'}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleLogout}
      >
        Abmelden
      </Button>
    </div>
  );
}

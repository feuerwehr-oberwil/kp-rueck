'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * «Abmelden» — one behaviour for every entry point (user menu, Mehr sheet, /display).
 *
 * It asks once, like /feld's «Nicht ich» and like KP Front: on the shared KP screen a stray
 * click on the last menu item ended the session for everybody using it, and the three places
 * did three different things afterwards (push to /login, wait for the guard, stay put). Now
 * every one asks the same question and lands on /login.
 */
export function useLogout() {
  const { logout } = useAuth();
  const router = useRouter();
  const t = useTranslations('nav.account');
  const [open, setOpen] = useState(false);

  const requestLogout = useCallback(() => setOpen(true), []);

  const logoutDialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={t('logoutTitle')}
      description={t('logoutDescription')}
      confirmText={t('logout')}
      cancelText={t('cancel')}
      onConfirm={async () => {
        await logout();
        setOpen(false);
        router.push('/login');
      }}
    />
  );

  return { requestLogout, logoutDialog };
}

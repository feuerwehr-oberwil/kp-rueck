'use client';

/**
 * `/divera-pool` – the Alarmeingang's old page, kept so links and bookmarks still arrive.
 *
 * The Alarmeingang is a sheet over the board now (`components/alarm-inbox/`): this opens it and
 * replaces the address with the board. Behind ProtectedRoute like the board, so a viewer is
 * still sent to /display/board and the pool is never fetched for one.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/protected-route';
import { openAlarmInbox } from '@/components/alarm-inbox/alarm-inbox-store';

export default function DiveraPoolPage() {
  return (
    <ProtectedRoute>
      <OpenOnBoard />
    </ProtectedRoute>
  );
}

function OpenOnBoard() {
  const router = useRouter();
  useEffect(() => {
    openAlarmInbox();
    router.replace('/');
  }, [router]);
  return null;
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Users } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Personal einchecken (Übungssteuerung): checks random available people into the
 * exercise — immediately or trickled over minutes, the way an Aufgebot really
 * arrives. Its own card since the 2026-08-19 restructure (it prepares the
 * exercise rather than simulating field actions).
 */
export function TrainingCheckinCard() {
  const t = useTranslations('training.checkin');
  const { selectedEvent } = useEvent();
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [count, setCount] = useState(10);
  // 0 = sofort; >0 = check-ins trickle in over this many minutes.
  const [minutes, setMinutes] = useState(0);

  if (!selectedEvent?.training_flag) {
    return null;
  }

  const handleSimulateCheckin = async () => {
    if (!selectedEvent) return;
    setIsCheckingIn(true);
    try {
      const result = await apiClient.simulateCheckin(selectedEvent.id, count, minutes);

      if ((result.scheduled?.length ?? 0) > 0) {
        toast.success(t('scheduled', { count: result.scheduled!.length }), {
          description: t('scheduledDescription', { minutes: result.trickle_minutes ?? minutes }),
        });
      } else if (result.checked_in.length === 0) {
        toast.info(t('noMorePersons'), {
          description: t('noMorePersonsDescription'),
        });
      }
    } catch (error: unknown) {
      console.error('Failed to simulate check-in:', error);
      const detail = error instanceof Error ? error.message : undefined;
      toast.error(t('failed'), { description: detail });
    } finally {
      setIsCheckingIn(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-sky-600" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            className="w-20"
            aria-label={t('countAria')}
          />
          <Select value={String(minutes)} onValueChange={(v) => setMinutes(parseInt(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t('immediately')}</SelectItem>
              <SelectItem value="5">{t('overMinutes', { count: 5 })}</SelectItem>
              <SelectItem value="10">{t('overMinutes', { count: 10 })}</SelectItem>
              <SelectItem value="15">{t('overMinutes', { count: 15 })}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={handleSimulateCheckin}
            disabled={isCheckingIn}
            variant="outline"
            size="sm"
            className="flex-1"
          >
            <Users className="size-3.5" />
            {isCheckingIn ? t('checkingIn') : t('checkin')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

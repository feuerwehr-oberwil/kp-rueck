'use client';

import { useState } from 'react';
import { useCurrentTime } from '@/lib/hooks/use-current-time';
import { useTranslations } from 'next-intl';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ShellLoader } from '@/components/ui/shell-loader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Square, Users } from 'lucide-react';
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
 * exercise rather than simulating field actions). A trickle can be stopped: the
 * «Stoppen» row shows from the start until its window ends, and also after a 409
 * («läuft bereits») – the backend knows about a trickle the page may not.
 */
export function TrainingCheckinCard() {
  const t = useTranslations('training.checkin');
  const { selectedEvent } = useEvent();
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [count, setCount] = useState(10);
  // 0 = sofort; >0 = check-ins trickle in over this many minutes.
  const [minutes, setMinutes] = useState(0);
  // Until when a trickle runs (ms), as far as this page knows; null = none known.
  const [trickleUntil, setTrickleUntil] = useState<number | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  // A coarse clock hides the «Stoppen» row once the trickle's window has passed.
  const { currentTime } = useCurrentTime(5000);
  const trickling = trickleUntil !== null && currentTime !== null && currentTime.getTime() < trickleUntil;

  if (!selectedEvent?.training_flag) {
    return null;
  }

  const handleSimulateCheckin = async () => {
    if (!selectedEvent) return;
    setIsCheckingIn(true);
    try {
      const result = await apiClient.simulateCheckin(selectedEvent.id, count, minutes);

      if ((result.scheduled?.length ?? 0) > 0) {
        setTrickleUntil(Date.now() + (result.trickle_minutes ?? minutes) * 60_000);
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
      // «läuft bereits»: offer the stop for a trickle this page did not start.
      if (ApiError.isConflictError(error)) setTrickleUntil(Date.now() + 30 * 60_000);
      const detail = error instanceof Error ? error.message : undefined;
      toast.error(t('failed'), { description: detail });
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      const { stopped } = await apiClient.stopSimulatedCheckin(selectedEvent.id);
      setTrickleUntil(null);
      if (stopped > 0) toast.success(t('stopped', { count: stopped }));
      else toast.info(t('stoppedNone'));
    } catch (error: unknown) {
      toast.error(t('stopFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Phone: Anzahl + Tempo on one line, the button full width under them — in one
            row at 390px «Einchecken» ran out of its box. From md up, one row as before.
            The button is as tall as the fields beside it (`--field-h`) on every width. */}
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 md:flex">
          <Input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
            className="w-full md:w-20"
            aria-label={t('countAria')}
          />
          <Select value={String(minutes)} onValueChange={(v) => setMinutes(parseInt(v))}>
            <SelectTrigger className="w-full md:w-32">
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
            className="col-span-2 min-h-(--field-h) md:flex-1"
          >
            {isCheckingIn ? <ShellLoader className="size-3.5" /> : <Users className="size-3.5" />}
            {isCheckingIn ? t('checkingIn') : t('checkin')}
          </Button>
        </div>
        {trickling && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 flex-1">{t('running')}</span>
            <Button onClick={handleStop} disabled={isStopping} variant="outline" size="sm" className="flex-shrink-0">
              {isStopping ? <ShellLoader className="size-3.5" /> : <Square className="size-3.5" />}
              {t('stop')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

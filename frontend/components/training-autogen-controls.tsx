'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Timer } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Trainer controls for the backend auto-generation monitor
// (backend/app/services/training_autogen_task.py). All knobs are plain
// settings; the monitor picks changes up within ~5s — no restart needed.
export function TrainingAutogenControls() {
  const t = useTranslations('training.autogen');
  const { selectedEvent } = useEvent();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [intervalMin, setIntervalMin] = useState(5);
  const [maxEmergencies, setMaxEmergencies] = useState(50);
  const [mode, setMode] = useState<'board' | 'divera'>('board');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedEvent?.training_flag || loaded) return;
    apiClient
      .getAllSettings()
      .then((settings) => {
        setEnabled(settings['training_autogen_enabled'] === 'true');
        setIntervalMin(parseFloat(settings['training_autogen_interval_min']) || 5);
        setMaxEmergencies(parseInt(settings['training_autogen_max_emergencies']) || 50);
        setMode(settings['training_autogen_mode'] === 'divera' ? 'divera' : 'board');
        setLoaded(true);
      })
      .catch(() => {
        // settings unavailable — card stays with defaults, toggle still works
        setLoaded(true);
      });
  }, [selectedEvent?.training_flag, loaded]);

  if (!selectedEvent?.training_flag) {
    return null;
  }

  const save = async (key: string, value: string): Promise<boolean> => {
    setSaving(true);
    try {
      await apiClient.updateSetting(key, value);
      return true;
    } catch {
      toast.error(t('saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (on: boolean) => {
    setEnabled(on);
    if (!(await save('training_autogen_enabled', on ? 'true' : 'false'))) {
      setEnabled(!on);
      return;
    }
    toast.success(on ? t('started') : t('stopped'), {
      description: on
        ? t('startedDescription', { interval: intervalMin })
        : t('stoppedDescription'),
    });
  };

  const handleIntervalCommit = async (value: number) => {
    const clamped = Math.max(1, Math.min(60, value));
    setIntervalMin(clamped);
    await save('training_autogen_interval_min', String(clamped));
  };

  const handleMaxCommit = async (value: number) => {
    const clamped = Math.max(1, Math.min(200, value));
    setMaxEmergencies(clamped);
    await save('training_autogen_max_emergencies', String(clamped));
  };

  const handleModeChange = async (value: 'board' | 'divera') => {
    setMode(value);
    await save('training_autogen_mode', value);
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-emerald-600" />
              {t('title')}
            </CardTitle>
            <CardDescription>
              {t('description')}
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={!loaded || saving}
            aria-label={t('toggleAria')}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="autogen-interval">{t('intervalLabel')}</Label>
            <Input
              id="autogen-interval"
              type="number"
              min={1}
              max={60}
              value={intervalMin}
              disabled={!loaded}
              onChange={(e) => setIntervalMin(parseFloat(e.target.value) || 1)}
              onBlur={(e) => handleIntervalCommit(parseFloat(e.target.value) || 5)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="autogen-max">{t('maxLabel')}</Label>
            <Input
              id="autogen-max"
              type="number"
              min={1}
              max={200}
              value={maxEmergencies}
              disabled={!loaded}
              onChange={(e) => setMaxEmergencies(parseInt(e.target.value) || 1)}
              onBlur={(e) => handleMaxCommit(parseInt(e.target.value) || 50)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>{t('alarmPath')}</Label>
          <Select value={mode} onValueChange={(v) => handleModeChange(v as 'board' | 'divera')}>
            <SelectTrigger className="w-full" disabled={!loaded}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="board">{t('modeBoard')}</SelectItem>
              <SelectItem value="divera">{t('modeDivera')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('hint')}
        </p>
        {enabled && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => handleToggle(false)}>
            {t('stop')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

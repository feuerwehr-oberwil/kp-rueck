'use client';

import { useEffect, useState } from 'react';
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

  const save = async (key: string, value: string) => {
    setSaving(true);
    try {
      await apiClient.updateSetting(key, value);
    } catch {
      toast.error('Einstellung konnte nicht gespeichert werden');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (on: boolean) => {
    setEnabled(on);
    await save('training_autogen_enabled', on ? 'true' : 'false');
    toast.success(on ? 'Automatik gestartet' : 'Automatik gestoppt', {
      description: on
        ? `Neue Alarme alle ~${intervalMin} Min (erste 30 Min doppeltes Tempo).`
        : 'Es werden keine Einsätze mehr automatisch generiert.',
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
              Automatik
            </CardTitle>
            <CardDescription>
              Generiert laufend neue Einsätze — du beobachtest, statt Knöpfe zu drücken
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={!loaded || saving}
            aria-label="Automatik ein/aus"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="autogen-interval">Intervall (Min)</Label>
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
            <Label htmlFor="autogen-max">Max. Einsätze</Label>
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
          <Label>Alarmweg</Label>
          <Select value={mode} onValueChange={(v) => handleModeChange(v as 'board' | 'divera')}>
            <SelectTrigger className="w-full" disabled={!loaded}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="board">Direkt aufs Board</SelectItem>
              <SelectItem value="divera">Über Divera-Pool (echter Alarmierungs-Weg)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Wirkt auf die neueste aktive Übung. In den ersten 30 Minuten läuft die Generierung mit
          doppeltem Tempo (heisse Phase). &quot;Über Divera-Pool&quot; lässt Alarme im Notfall-Pool
          eingehen — der Operator übernimmt sie dort wie im Ernstfall.
        </p>
        {enabled && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => handleToggle(false)}>
            Automatik stoppen
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

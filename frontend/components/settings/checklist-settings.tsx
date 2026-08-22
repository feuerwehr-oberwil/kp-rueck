'use client';

/**
 * Which steps this station's setup checklist runs, and who each shared link is
 * for.
 *
 * The rows themselves stay in code (several of them tick themselves off live
 * state — drivers, printer, check-in count — which no hand-written row could
 * do). What a station owns is narrower and more useful: switching off a step it
 * never performs, and writing its own «für wen · wie viele Ausdrucke» note,
 * because that number is a property of the Magazin, not of the software.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingCard } from '@/components/settings/setting-row';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import {
  CHECKLIST_HIDDEN_TASKS_KEY,
  CHECKLIST_NOTES_KEY,
  listChecklistTasks,
  parseHiddenTasks,
  parseTaskNotes,
} from '@/lib/checklist-tasks';
import { cn } from '@/lib/utils';

export function ChecklistSettings({ readOnly = false }: { readOnly?: boolean }) {
  const t = useTranslations('settings.page.checklist');
  const tasks = listChecklistTasks();

  const [loaded, setLoaded] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getAllSettings()
      .then((settings) => {
        setHidden(parseHiddenTasks(settings));
        setNotes(parseTaskNotes(settings));
      })
      .catch(() => toast.error(t('loadFailed')))
      .finally(() => setLoaded(true));
  }, [t]);

  const save = async (key: string, value: string) => {
    setSaving(key);
    try {
      await apiClient.updateSetting(key, value);
      return true;
    } catch {
      toast.error(t('saveFailed'));
      return false;
    } finally {
      setSaving(null);
    }
  };

  const toggleTask = async (id: string, show: boolean) => {
    const next = new Set(hidden);
    if (show) next.delete(id);
    else next.add(id);
    setHidden(next);
    if (!(await save(CHECKLIST_HIDDEN_TASKS_KEY, JSON.stringify([...next])))) {
      setHidden(hidden); // put the switch back where the station left it
    }
  };

  /** Persist a note on blur. An empty field removes the line entirely. */
  const commitNote = async (id: string, value: string, defaultNote?: string) => {
    const trimmed = value.trim();
    const next = { ...notes };
    // Typing the built-in text back in should return the row to "default",
    // rather than pinning a copy that stops following future wording changes.
    if (trimmed === (defaultNote ?? '').trim()) delete next[id];
    else next[id] = trimmed;
    if (JSON.stringify(next) === JSON.stringify(notes)) return;
    setNotes(next);
    if (!(await save(CHECKLIST_NOTES_KEY, JSON.stringify(next)))) setNotes(notes);
  };

  if (!loaded) {
    return (
      <Card className="p-5 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  const visibleCount = tasks.filter((task) => !hidden.has(task.id)).length;

  return (
    <SettingCard title={t('title')} subtitle={t('description')}>
      <div className="space-y-4">
        <div className="divide-y divide-border rounded-lg border border-border">
          {tasks.map((task) => {
            const isShown = !hidden.has(task.id);
            const noteValue = notes[task.id] ?? task.defaultNote ?? '';
            return (
              <div key={task.id} className={cn('space-y-2 p-3', !isShown && 'opacity-60')}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{task.title}</span>
                  <Switch
                    checked={isShown}
                    disabled={readOnly || saving === CHECKLIST_HIDDEN_TASKS_KEY}
                    onCheckedChange={(on) => void toggleTask(task.id, on)}
                    aria-label={t('showRow', { title: task.title })}
                  />
                </div>
                {isShown && (
                  <Input
                    defaultValue={noteValue}
                    key={noteValue}
                    placeholder={t('notePlaceholder')}
                    className="h-8 text-xs"
                    disabled={readOnly || saving === CHECKLIST_NOTES_KEY}
                    onBlur={(e) => void commitNote(task.id, e.target.value, task.defaultNote)}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">{t('summary', { count: visibleCount })}</p>
      </div>
    </SettingCard>
  );
}

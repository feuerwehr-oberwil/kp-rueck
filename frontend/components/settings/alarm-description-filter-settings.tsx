'use client';

/**
 * Standing lines the dispatch system injects into every alarm text.
 *
 * Divera lets a brigade configure boilerplate ("Ausrückeordnung: 1. TLF → 2. PIO") that then
 * arrives on EVERY alarm — identical each time, so on the board it is noise that crowds out
 * the «Details:» line that says what happened. Any incoming line starting with one of these
 * prefixes is dropped from the incident's description; the received alarm itself is stored
 * unchanged, so the provenance record stays complete.
 *
 * A configurable prefix list rather than a switch: the vocabulary is the brigade's, and the
 * next standing line the dispatch system grows costs a settings edit, not a release. One
 * prefix per line — same storage shape as the /feld chips next to it.
 */

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Settings key + shipped default; must match `DEFAULT_SETTINGS` in backend/app/services/settings.py. */
export const ALARM_DESCRIPTION_FILTER_PREFIXES_KEY = 'alarm.description_filter_prefixes';
export const DEFAULT_ALARM_DESCRIPTION_FILTER_PREFIXES = 'Ausrückeordnung:';

interface Props {
  settings: Record<string, string>;
  serverSettings: Record<string, string>;
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  updateSetting: (key: string, value: string) => void | Promise<void>;
  isEditor: boolean;
  saving: string | null;
}

export function AlarmDescriptionFilterSettings({
  settings,
  serverSettings,
  setSettings,
  updateSetting,
  isEditor,
  saving,
}: Props) {
  const t = useTranslations('settings.page.alerting');
  const tCommon = useTranslations('settings.common');
  const key = ALARM_DESCRIPTION_FILTER_PREFIXES_KEY;
  const fallback = DEFAULT_ALARM_DESCRIPTION_FILTER_PREFIXES;
  const value = settings[key] !== undefined ? settings[key] : fallback;
  const isCurrentlySaving = saving === key;

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="font-medium">{t('alarmFilterTitle')}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('alarmFilterDescription')}</p>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm font-semibold text-muted-foreground">{t('alarmFilterLabel')}</Label>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            disabled={!isEditor || isCurrentlySaving || value === fallback}
            onClick={() => updateSetting(key, fallback)}
          >
            {tCommon('reset')}
          </Button>
        </div>
        <Textarea
          value={value}
          rows={3}
          className="font-mono text-xs"
          onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
          onBlur={(e) => {
            if (e.target.value !== (serverSettings[key] ?? fallback)) {
              updateSetting(key, e.target.value);
            }
          }}
          disabled={!isEditor || isCurrentlySaving}
        />
        <p className="text-xs text-muted-foreground">{t('alarmFilterHint')}</p>
      </div>
    </Card>
  );
}

'use client';

/**
 * Tidying the description of an inbound alarm — two station-configured lists.
 *
 * A dispatch system labels and pads what it sends. Divera's two lines are
 * «Meldung: <Text der Alarmzentrale>» and «Ausrückeordnung: 1. TLF → 2. PIO»: the second is
 * identical on every alarm, and the first repeats a word our own UI already prints above the
 * field. So one list DROPS a whole line, the other STRIPS a label and keeps what follows it.
 *
 * BOTH SHIP EMPTY. The vocabulary is one brigade's arrangement with its Leitstelle, and this
 * is a product other stations self-host — a fresh install filters nothing, and the copy says
 * so rather than presenting anyone's lines as a preset. One prefix per line, same storage
 * shape as the /feld chips next to it.
 *
 * Applies to the incident's description only; the received alarm stays stored unchanged, so
 * the provenance record — and the text priority inference reads — is untouched.
 */

import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Settings keys; must match `DEFAULT_SETTINGS` in backend/app/services/settings.py. */
export const ALARM_DESCRIPTION_FILTER_PREFIXES_KEY = 'alarm.description_filter_prefixes';
export const ALARM_DESCRIPTION_LABEL_PREFIXES_KEY = 'alarm.description_label_prefixes';

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

  /** Both fields behave identically — same storage, same empty default, saved on blur. */
  const field = (key: string, label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold text-muted-foreground">{label}</Label>
      <Textarea
        value={settings[key] ?? ''}
        rows={3}
        className="font-mono text-xs"
        onChange={(e) => setSettings((prev) => ({ ...prev, [key]: e.target.value }))}
        onBlur={(e) => {
          if (e.target.value !== (serverSettings[key] ?? '')) {
            updateSetting(key, e.target.value);
          }
        }}
        disabled={!isEditor || saving === key}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="font-medium">{t('alarmFilterTitle')}</h3>
        <p className="text-xs text-muted-foreground mt-1">{t('alarmFilterDescription')}</p>
      </div>
      {field(ALARM_DESCRIPTION_FILTER_PREFIXES_KEY, t('alarmFilterLabel'), t('alarmFilterDropHint'))}
      {field(ALARM_DESCRIPTION_LABEL_PREFIXES_KEY, t('alarmFilterLabelsLabel'), t('alarmFilterLabelsHint'))}
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs font-semibold text-muted-foreground">{t('alarmFilterExampleTitle')}</p>
        <p className="text-xs text-muted-foreground mt-1">{t('alarmFilterExample')}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t('alarmFilterHint')}</p>
    </Card>
  );
}

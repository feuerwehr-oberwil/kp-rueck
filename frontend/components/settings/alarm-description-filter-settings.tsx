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
import { Textarea } from '@/components/ui/textarea';
import { SettingBlock, SettingCard } from '@/components/settings/setting-row';

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
  const t = useTranslations('settings.page.alarmIntake');

  /** Both fields behave identically — same storage, same empty default, saved on blur. */
  const field = (key: string, label: string, hint: string) => (
    <SettingBlock label={label} htmlFor={key} hint={hint}>
      <Textarea
        id={key}
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
    </SettingBlock>
  );

  return (
    <SettingCard
      title={t('alarmFilterTitle')}
      subtitle={t('alarmFilterDescription')}
    >
      {field(ALARM_DESCRIPTION_FILTER_PREFIXES_KEY, t('alarmFilterLabel'), t('alarmFilterDropHint'))}
      {field(ALARM_DESCRIPTION_LABEL_PREFIXES_KEY, t('alarmFilterLabelsLabel'), t('alarmFilterLabelsHint'))}
      <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs font-semibold">{t('alarmFilterExampleTitle')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('alarmFilterExample')}</p>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('alarmFilterHint')}</p>
    </SettingCard>
  );
}

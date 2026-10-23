'use client';

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useEffectEvent } from '@/lib/hooks/use-effect-event';
import { useTranslations } from 'next-intl';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingRow } from '@/components/settings/setting-row';
import {
  normalizeDecimal,
  validateRangedSetting,
  type SettingRange,
  type SettingValidationError,
} from '@/components/settings/setting-validation';

/**
 * The station's key/value settings (`GET/PATCH /api/settings`): one store and
 * one config-driven form.
 *
 * - `useStationSettings` loads every key once and is the single save path
 *   (`updateSetting`). The settings page hands its store to each section that
 *   edits keys; `PrinterSettings` keeps a store of its own.
 * - `StationSettingsForm` renders a `SettingConfig[]` from that store as
 *   `SettingRow`s – switch, select or text field per type – and validates
 *   ranged numbers before they are saved.
 */

export interface SettingConfig {
  key: string;
  type: 'number' | 'boolean' | 'text' | 'select';
  unit?: string;
  options?: string[];
  /** Inclusive bounds for a `number`. Rejected client-side – the PATCH stores any string. */
  range?: SettingRange;
}

export interface StationSettings {
  /** What the inputs show – may hold an edit not saved yet. */
  settings: Record<string, string>;
  setSettings: Dispatch<SetStateAction<Record<string, string>>>;
  /** What the server last confirmed; a blur saves only when the input differs. */
  serverSettings: Record<string, string>;
  loading: boolean;
  error: string | null;
  /** The key whose PATCH is in flight. */
  saving: string | null;
  /** Per-key validation failures of `StationSettingsForm`. Kept here, not in the
   *  form, so they outlive a switch to another section and back. */
  settingErrors: Record<string, SettingValidationError>;
  setSettingErrors: Dispatch<SetStateAction<Record<string, SettingValidationError>>>;
  reload: () => Promise<void>;
  updateSetting: (key: string, value: string) => Promise<void>;
}

/**
 * Loads all settings whenever `enabled` turns true. `canEdit` false refuses a
 * save with a toast instead of sending it; `onSaved` runs after a confirmed
 * save (the printer re-reads its status there).
 */
export function useStationSettings({
  enabled,
  canEdit,
  onSaved,
}: {
  enabled: boolean;
  canEdit: boolean;
  onSaved?: (key: string, value: string) => void;
}): StationSettings {
  const t = useTranslations('settings');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [serverSettings, setServerSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Per-key validation failures for the ranged settings (the station coordinates).
  // A rejected value stays in the input so the operator can fix the typo instead of
  // retyping the whole coordinate – it is simply not PATCHed.
  const [settingErrors, setSettingErrors] = useState<Record<string, SettingValidationError>>({});

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getAllSettings();
      setSettings(data);
      setServerSettings(data);
    } catch (err) {
      console.error('Failed to fetch settings:', err);
      setError(err instanceof Error ? err.message : t('common.loadError'));
      toast.error(t('common.loadSettingsError'));
    } finally {
      setLoading(false);
    }
  };

  // Load when the form becomes enabled; `reload` is a plain function, reached through an
  // effect event.
  const loadWhenEnabled = useEffectEvent(() => void reload());
  useEffect(() => {
    if (enabled) {
      loadWhenEnabled();
    }
  }, [enabled]);

  const updateSetting = async (key: string, value: string) => {
    if (!canEdit) {
      toast.error(t('page.toasts.editorsOnly'));
      return;
    }
    setSaving(key);
    try {
      await apiClient.updateSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      setServerSettings((prev) => ({ ...prev, [key]: value }));
      onSaved?.(key, value);
    } catch (err) {
      console.error(`Failed to update setting ${key}:`, err);
      toast.error(t('common.saveError'));
    } finally {
      setSaving(null);
    }
  };

  return {
    settings,
    setSettings,
    serverSettings,
    loading,
    error,
    saving,
    settingErrors,
    setSettingErrors,
    reload,
    updateSetting,
  };
}

/** Per-key additions the page knows and the config does not. */
export interface SettingRowExtra {
  /** Rendered under the row (see `SettingRow`'s `footer`). */
  footer?: ReactNode;
  /** Select options to grey out, with the reason shown beside them. The stored
   *  value always stays selectable, or the select would show a disabled item as
   *  its own value. */
  unavailableOptions?: Partial<Record<string, string>>;
}

/**
 * One `SettingRow` per config, labels and hints from
 * `settings.page.general.configs.<key>.*`. Read-only unless `isEditor`.
 */
export function StationSettingsForm({
  configs,
  store,
  isEditor,
  extras = {},
}: {
  configs: readonly SettingConfig[];
  store: StationSettings;
  isEditor: boolean;
  extras?: Partial<Record<string, SettingRowExtra>>;
}) {
  const t = useTranslations('settings');
  const { settings, setSettings, serverSettings, saving, settingErrors, setSettingErrors, updateSetting } = store;

  const renderSettingInput = (config: SettingConfig) => {
    const value = settings[config.key] || '';
    const isCurrentlySaving = saving === config.key;

    // Boolean without options → render as Switch
    if (config.type === 'boolean' && !config.options) {
      return (
        <Switch
          id={config.key}
          checked={value === 'true' || value === ''}
          onCheckedChange={(checked) => updateSetting(config.key, String(checked))}
          disabled={!isEditor || isCurrentlySaving}
        />
      );
    }

    if ((config.type === 'boolean' || config.type === 'select') && config.options) {
      const unavailableOptions = extras[config.key]?.unavailableOptions;
      return (
        <Select
          value={value}
          onValueChange={(newValue) => updateSetting(config.key, newValue)}
          disabled={!isEditor || isCurrentlySaving}
        >
          <SelectTrigger id={config.key} className="w-full">
            <SelectValue placeholder={t('page.general.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {config.options.map((option) => {
              const reason = value !== option ? unavailableOptions?.[option] : undefined;
              const unavailable = reason !== undefined;
              return (
                <SelectItem key={option} value={option} disabled={unavailable}>
                  {t(`page.general.configs.${config.key}.options.${option}`)}
                  {unavailable && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {reason}
                    </span>
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      );
    }

    const validationError = settingErrors[config.key];

    return (
      <div className="space-y-1">
        <Input
          id={config.key}
          // `text`, not `number`, even for the ranged ones: a number input silently
          // discards a pasted "47,5164" instead of letting the comma be normalised,
          // and its spinner is useless at six decimal places.
          type="text"
          inputMode={config.range ? 'decimal' : undefined}
          value={value}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? `${config.key}-error` : undefined}
          onChange={(e) => {
            setSettings((prev) => ({ ...prev, [config.key]: e.target.value }));
            setSettingErrors((prev) => {
              if (!(config.key in prev)) return prev;
              const { [config.key]: _removed, ...rest } = prev;
              return rest;
            });
          }}
          onBlur={(e) => {
            const raw = e.target.value;
            if (config.range) {
              const problem = validateRangedSetting(raw, config.range);
              if (problem) {
                setSettingErrors((prev) => ({ ...prev, [config.key]: problem }));
                return;
              }
            }
            const next = config.range ? normalizeDecimal(raw) : raw;
            if (next !== raw) setSettings((prev) => ({ ...prev, [config.key]: next }));
            if (next !== serverSettings[config.key]) {
              updateSetting(config.key, next);
            }
          }}
          disabled={!isEditor || isCurrentlySaving}
        />
        {validationError && config.range && (
          <p id={`${config.key}-error`} className="text-xs text-destructive">
            {t(`page.general.validation.${validationError}`, {
              min: config.range.min,
              max: config.range.max,
            })}
          </p>
        )}
      </div>
    );
  };

  return configs.map((config) => (
    <SettingRow
      key={config.key}
      label={t(`page.general.configs.${config.key}.label`)}
      htmlFor={config.key}
      hint={t(`page.general.configs.${config.key}.description`)}
      footer={extras[config.key]?.footer ?? null}
    >
      <div className="flex w-full items-start gap-2">
        {/* Schalter drängen sich an die rechte Kante, alles mit einem Feld
            füllt die Spalte – so steht eine Kante über die ganze Karte. */}
        <div className={config.type === 'boolean' && !config.options ? 'ml-auto' : 'min-w-0 flex-1'}>
          {renderSettingInput(config)}
        </div>
        {saving === config.key && <Save className="mt-2.5 h-4 w-4 shrink-0 text-muted-foreground animate-pulse" />}
      </div>
    </SettingRow>
  ));
}

'use client';

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useEffectEvent } from '@/lib/hooks/use-effect-event';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { SAVED_LINE_MS } from '@/components/kanban/field-save-status';
import { formatClockTime } from '@/lib/incident-time';
import { cn } from '@/lib/utils';
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
  roundDecimal,
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
  /** Fixed decimal places for a `number`: the stored value is SHOWN rounded, and a blur
   *  saves it rounded (`roundDecimal`) – the station coordinates' 6. */
  decimals?: number;
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
  /** When the server last confirmed each key in this visit – what «Gespeichert – hh:mm» reads. */
  savedAt: Record<string, Date>;
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
  const [savedAt, setSavedAt] = useState<Record<string, Date>>({});
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
      setSavedAt((prev) => ({ ...prev, [key]: new Date() }));
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
    savedAt,
    settingErrors,
    setSettingErrors,
    reload,
    updateSetting,
  };
}

/**
 * The quiet line under a setting's control: «Wird gespeichert …» while the PATCH is
 * out, then «Gespeichert – hh:mm» once the server confirmed – the same words and the
 * same few seconds as under a text field of the Einsatz detail (`FieldSaveStatus`).
 * These settings save by themselves on blur or on a click and have no button, so
 * without it only a failure ever said anything. A failure is still the toast.
 */
export function SettingSaveLine({
  saving,
  savedAt,
  className = 'mt-1',
}: {
  saving: boolean;
  savedAt: Date | undefined;
  /** Default: the gap under a field. Beside a switch pass none. */
  className?: string;
}) {
  const t = useTranslations('kanban.fieldSave');
  // The confirmation whose line has run out – by identity, so a newer one shows at once.
  const [expired, setExpired] = useState<Date | null>(null);
  useEffect(() => {
    if (!savedAt) return;
    const left = Math.max(0, SAVED_LINE_MS - (Date.now() - savedAt.getTime()));
    const id = window.setTimeout(() => setExpired(savedAt), left);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  if (saving) {
    return (
      <p role="status" aria-live="polite" className={cn('text-xs text-muted-foreground', className)}>
        {t('saving')}
      </p>
    );
  }
  if (!savedAt || expired === savedAt) return null;
  return (
    <p role="status" aria-live="polite" className={cn('flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground', className)}>
      <Check className="size-3 shrink-0 text-success" aria-hidden="true" />
      {t('savedAt', { time: formatClockTime(savedAt) })}
    </p>
  );
}

/** Per-key additions the page knows and the config does not. */
export interface SettingRowExtra {
  /** Rendered under the row's description (see `SettingRow`'s `advice`). */
  advice?: ReactNode;
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
  const { settings, setSettings, serverSettings, saving, savedAt, settingErrors, setSettingErrors, updateSetting } = store;

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
    // A value as the server has it shows rounded; once the operator types, the field shows
    // exactly what they typed until the blur rounds and saves it.
    const shown =
      config.decimals !== undefined && value === serverSettings[config.key]
        ? roundDecimal(value, config.decimals)
        : value;

    return (
      <div className="space-y-1">
        <Input
          id={config.key}
          // `text`, not `number`, even for the ranged ones: a number input silently
          // discards a pasted "47,5164" instead of letting the comma be normalised,
          // and its spinner is useless at six decimal places.
          type="text"
          inputMode={config.range ? 'decimal' : undefined}
          // A number (today: the Magazin's latitude/longitude, 6 decimals) reads in
          // Spline Sans Mono with tabular figures. Size and padding stay the Input's own:
          // 14/20 from md, 16px below it (iOS zooms into a smaller field).
          className={config.type === 'number' ? 'font-mono tabular-nums' : undefined}
          value={shown}
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
            const normalized = config.range ? normalizeDecimal(raw) : raw;
            const next = config.decimals !== undefined ? roundDecimal(normalized, config.decimals) : normalized;
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
      advice={extras[config.key]?.advice ?? null}
    >
      {config.type === 'boolean' && !config.options ? (
        // A switch keeps the right edge; its line stands beside it, so the row does not
        // grow and shrink with every click.
        <div className="ml-auto flex items-center justify-end gap-2">
          <SettingSaveLine saving={saving === config.key} savedAt={savedAt[config.key]} className="" />
          {renderSettingInput(config)}
        </div>
      ) : (
        // Everything with a field fills the column – one edge down the whole card.
        <div className="w-full min-w-0">
          {renderSettingInput(config)}
          <SettingSaveLine saving={saving === config.key} savedAt={savedAt[config.key]} />
        </div>
      )}
    </SettingRow>
  ));
}

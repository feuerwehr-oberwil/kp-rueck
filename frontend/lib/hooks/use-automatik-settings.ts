"use client"

import { useCallback, useEffect, useState } from "react"

import { apiClient } from "@/lib/api-client"

const INTERVAL_KEY = "training_autogen_interval_min"
const MAX_KEY = "training_autogen_max_emergencies"

/** The two plain settings of the Automatik: minutes between alarms (1–60) and the maximum
 *  number of incidents it raises (1–200). */
export interface AutomatikSettings {
  intervalMin: number
  max: number
}

const DEFAULTS: AutomatikSettings = { intervalMin: 5, max: 50 }
const RANGE: Record<keyof AutomatikSettings, [number, number]> = { intervalMin: [1, 60], max: [1, 200] }
const KEY: Record<keyof AutomatikSettings, string> = { intervalMin: INTERVAL_KEY, max: MAX_KEY }

/**
 * Interval and maximum of the training Automatik, for the Übungs-Steuerung's «Vorbereiten»
 * (and the «Maximum erreicht» line). Loaded once while `enabled`; until then, or when the
 * settings cannot be read, the defaults show. `save` clamps the value to its range, shows
 * it at once and writes it; it resolves false when the write failed. The backend monitor
 * picks a change up within seconds.
 */
export function useAutomatikSettings(enabled: boolean) {
  const [settings, setSettings] = useState<AutomatikSettings>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!enabled || loaded) return
    let cancelled = false
    apiClient
      .getAllSettings()
      .then((all) => {
        if (cancelled) return
        setSettings({
          intervalMin: parseFloat(all[INTERVAL_KEY]) || DEFAULTS.intervalMin,
          max: parseInt(all[MAX_KEY]) || DEFAULTS.max,
        })
      })
      .catch(() => {}) // the defaults stay; a save still works
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, loaded])

  const save = useCallback(async (field: keyof AutomatikSettings, value: number): Promise<boolean> => {
    const [min, max] = RANGE[field]
    const clamped = Math.max(min, Math.min(max, value))
    setSettings((current) => ({ ...current, [field]: clamped }))
    try {
      await apiClient.updateSetting(KEY[field], String(clamped))
      return true
    } catch {
      return false
    }
  }, [])

  return { settings, loaded, save }
}

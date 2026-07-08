'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'gps-sim-speed-kmh'
const CHANGE_EVENT = 'gps-sim-speed-change'

export const GPS_SIM_SPEED_MIN = 10
export const GPS_SIM_SPEED_MAX = 100
export const DEFAULT_GPS_SIM_SPEED_KMH = 30

function readSpeed(): number {
  if (typeof window === 'undefined') return DEFAULT_GPS_SIM_SPEED_KMH
  try {
    const parsed = Number(window.localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(GPS_SIM_SPEED_MAX, Math.max(GPS_SIM_SPEED_MIN, parsed))
    }
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_GPS_SIM_SPEED_KMH
}

/**
 * Global GPS-simulation tempo (km/h), shared by the Übungssteuerung cards:
 * the GPS card owns the slider, the Nächste-Aktionen console starts its
 * drives with the same value. Persisted so it survives reloads; a custom
 * event keeps same-window consumers in sync, `storage` covers other tabs.
 */
export function useGpsSimSpeed(): [number, (speedKmh: number) => void] {
  const [speed, setSpeed] = useState<number>(readSpeed)

  useEffect(() => {
    const onChange = () => setSpeed(readSpeed())
    window.addEventListener(CHANGE_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const update = useCallback((speedKmh: number) => {
    setSpeed(speedKmh)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(speedKmh))
    } catch {
      // Persisting is best-effort; the in-memory value still applies.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return [speed, update]
}

import type { ApiGpsSimDrive } from '@/lib/api-client'

/** Human ETA for a simulated drive; <=5s counts as arrived (poll granularity). */
export const formatEta = (secs: number) => {
  if (secs <= 5) return 'angekommen'
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m > 0 ? `noch ~${m} min ${s}s` : `noch ~${s}s`
}

/**
 * Extrapolate a drive's progress/ETA between polls: positions are a pure
 * function of time server-side, so ticking them locally at 1 Hz keeps the
 * Übungssteuerung feeling live without hammering the API.
 */
export const liveDrive = (drive: ApiGpsSimDrive, fetchedAt: number, now: number) => {
  const dt = Math.max(0, (now - fetchedAt) / 1000)
  const eta = Math.max(0, drive.eta_seconds - dt)
  const progress =
    drive.eta_seconds > 0
      ? Math.min(1, drive.progress + (1 - drive.progress) * (dt / drive.eta_seconds))
      : drive.progress
  return { eta, progress }
}

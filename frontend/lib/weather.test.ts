import { describe, expect, it } from 'vitest'
import {
  activeWarnings,
  formatWeatherTime,
  frameAgeMinutes,
  isStale,
  radarIsStale,
  serverClockOffset,
  warningLevelColor,
  warningText,
  type ApiWeather,
  type WeatherRadar,
  type WeatherWarning,
} from './weather'

const NOW = Date.parse('2026-10-08T17:30:00Z')

function warning(overrides: Partial<WeatherWarning> = {}): WeatherWarning {
  return {
    id: 'meteoalarm:1',
    source: 'meteoswiss',
    level: 2,
    color: 'yellow',
    kind: 'rain',
    sent: '2026-10-07T08:41:05+00:00',
    onset: '2026-10-08T06:00:00+00:00',
    expires: '2026-10-09T06:00:00+00:00',
    sender: 'MeteoSwiss',
    link: 'http://www.meteoswiss.admin.ch',
    region: 'Luzern-Alpnach',
    texts: {
      de: { event: 'Starker Regen', headline: 'Starker Regen', description: '- Erwartete Mengen: 30-60 mm', instructions: [] },
      fr: { event: 'Fortes pluies', headline: 'Fortes pluies', description: '- Quantités attendues : 30-60 mm', instructions: [] },
    },
    fetched_at: '2026-10-08T17:25:00+00:00',
    ...overrides,
  }
}

function weather(items: WeatherWarning[]): ApiWeather {
  return {
    enabled: true,
    station_configured: true,
    generated_at: '2026-10-08T17:29:00+00:00',
    radar: null,
    warnings: { items, sources: {}, stale_after_seconds: 1500 },
  }
}

const radar: WeatherRadar = {
  frames: [
    { key: '202610081620', time: '2026-10-08T16:20:00+00:00' },
    { key: '202610081720', time: '2026-10-08T17:20:00+00:00' },
  ],
  coordinates: null,
  data_time: '2026-10-08T17:20:00+00:00',
  stale: false,
  stale_after_seconds: 900,
  status: { last_attempt_at: null, last_success_at: null, last_error: null, last_error_at: null },
  legend: [],
  attribution: 'MeteoSchweiz',
  source_url: 'https://www.meteoschweiz.admin.ch',
}

describe('staleness is measured on the device, not trusted from the server', () => {
  it('ages a frame against the limit', () => {
    expect(radarIsStale(radar, NOW)).toBe(false) // 10 min old, limit 15
    expect(radarIsStale(radar, NOW + 6 * 60_000)).toBe(true) // 16 min old
  })
  it('trusts the backend when it already called the radar stale', () => {
    expect(radarIsStale({ ...radar, stale: true }, NOW)).toBe(true)
  })
  it('measures the backend clock offset from generated_at', () => {
    // The tablet's clock runs 10 min behind the server: the offset puts it right.
    expect(serverClockOffset('2026-10-08T17:30:00Z', NOW - 10 * 60_000)).toBe(10 * 60_000)
    expect(serverClockOffset(null, NOW)).toBe(0)
    expect(serverClockOffset('garbage', NOW)).toBe(0)
  })
  it('treats no time at all as stale', () => {
    expect(isStale(null, 900, NOW)).toBe(true)
    expect(isStale('not a date', 900, NOW)).toBe(true)
  })
})

describe('warnings', () => {
  it('drops an expired warning at once and sorts the rest by level', () => {
    const red = warning({ id: 'r', level: 4 })
    const expired = warning({ id: 'x', expires: '2026-10-08T17:00:00+00:00' })
    const open = warning({ id: 'o', level: 2, expires: null }) // «bis auf Widerruf»
    expect(activeWarnings(weather([open, expired, red]), NOW).map((w) => w.id)).toEqual(['r', 'o'])
  })

  it('picks the board language verbatim, falling back to German', () => {
    expect(warningText(warning(), 'fr').event).toBe('Fortes pluies')
    expect(warningText(warning(), 'it').event).toBe('Starker Regen')
    expect(warningText(warning(), 'de').description).toBe('- Erwartete Mengen: 30-60 mm')
  })

  it('colours by awareness level and clamps odd values', () => {
    expect(warningLevelColor(2)).toBe('#facc15')
    expect(warningLevelColor(9)).toBe('#dc2626')
    expect(warningLevelColor(0)).toBe('#94a3b8')
  })
})

describe('frame times', () => {
  it('says how far back a scrubbed frame is', () => {
    expect(frameAgeMinutes(radar, 0)).toBe(60)
    expect(frameAgeMinutes(radar, 1)).toBe(0)
  })

  it('adds the weekday only when the moment is not today', () => {
    const today = formatWeatherTime('2026-10-08T15:05:00Z', 'de-CH', NOW)
    expect(today).toMatch(/^\d{2}:05$/)
    const tomorrow = formatWeatherTime('2026-10-10T06:00:00Z', 'de-CH', NOW)
    expect(tomorrow).toMatch(/^\S+ \d{2}:00$/)
  })
})

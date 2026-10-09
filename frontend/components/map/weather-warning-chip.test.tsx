import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { WeatherWarningChip } from './weather-warning-chip'
import { activeWarnings, type ApiWeather, type WeatherWarning } from '@/lib/weather'

const NOW = Date.parse('2026-10-08T17:30:00Z')

// The BL fire-danger alert as Alertswiss carried it on 08.10.2026 (shortened to two instructions).
const fireBan: WeatherWarning = {
  id: 'alertswiss:POA-1355976462-5',
  source: 'alertswiss',
  level: 2,
  color: null,
  kind: null,
  sent: '2026-09-11T10:23:21+00:00',
  onset: null,
  expires: null,
  sender: 'Kanton Basel-Landschaft',
  link: 'https://bit.ly/4xKMLH5',
  region: 'Ganzer Kanton Basel-Landschaft',
  texts: {
    de: {
      event: 'Feuerverbot',
      headline: 'Erhebliche Waldbrandgefahr (Stufe 3); Vorsicht vor Astabbrüchen',
      description: 'Aufgrund der anhaltenden Trockenheit gelten im Kanton Basel-Landschaft bis auf Weiteres verschiedene Massnahmen.\n\nDie Trockenheit führt zu einer erheblichen Waldbrandgefahr und zum Austrocknen von Bächen.',
      instructions: ['Es besteht ein Feuerwerksverbot.', 'Das Steigenlassen von  Himmelslaternen ist verboten.'],
    },
  },
  fetched_at: '2026-10-08T17:25:00+00:00',
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

describe('WeatherWarningChip', () => {
  it('names the warning in the source’s own word and opens the full text unaltered', async () => {
    const data = weather([fireBan])
    renderWithIntl(<WeatherWarningChip weather={data} warnings={activeWarnings(data, NOW)} now={NOW} />)

    const chip = screen.getByRole('button', { name: /Wetterwarnungen \(1\): Feuerverbot · bis auf Widerruf/ })
    await userEvent.click(chip)

    expect(await screen.findByText(fireBan.texts.de.headline)).toBeInTheDocument()
    // Verbatim – double space and line breaks included; nothing is trimmed or rephrased.
    expect(screen.getByText('Das Steigenlassen von  Himmelslaternen ist verboten.', { normalizer: (s) => s })).toBeInTheDocument()
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === fireBan.texts.de.description),
    ).toBeInTheDocument()
    expect(screen.getByText('Kanton Basel-Landschaft (via Alertswiss)')).toBeInTheDocument()
    expect(screen.getByText(/Ganzer Kanton Basel-Landschaft/)).toBeInTheDocument()
  })

  it('labels a warning whose source went quiet with the time it is from', async () => {
    const data = weather([fireBan])
    const later = NOW + 40 * 60_000 // fetched 17:25, limit 25 min
    renderWithIntl(<WeatherWarningChip weather={data} warnings={activeWarnings(data, later)} now={later} />)
    await userEvent.click(screen.getByRole('button'))
    expect(await screen.findByText(/Stand \d{2}:25 – Quelle zurzeit nicht erreichbar/)).toBeInTheDocument()
  })

  it('shows nothing without a warning', () => {
    const data = weather([])
    const { container } = renderWithIntl(<WeatherWarningChip weather={data} warnings={[]} now={NOW} />)
    expect(container).toBeEmptyDOMElement()
  })
})

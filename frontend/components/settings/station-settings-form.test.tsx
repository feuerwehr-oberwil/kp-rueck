import { useState, type ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de.json'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderHook, screen } from '@testing-library/react'

import { StationSettingsForm, useSettingSaver, useStationSettings, type SettingConfig, type StationSettings } from '@/components/settings/station-settings-form'
import { apiClient } from '@/lib/api-client'
import { COORDINATE_DECIMALS, LATITUDE_RANGE } from '@/components/settings/setting-validation'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/**
 * Owner pick D5 (08.11.2026): the station coordinates show and save with 6 decimals. The store is
 * a stand-in for `useStationSettings` – the form is what rounds.
 */
const CONFIGS: SettingConfig[] = [
  { key: 'firestation_latitude', type: 'number', range: LATITUDE_RANGE, decimals: COORDINATE_DECIMALS },
]

function Harness({
  stored,
  updateSetting,
  savingKey,
  savedAt = {},
}: {
  stored: string
  updateSetting: StationSettings['updateSetting']
  /** The key whose PATCH the stand-in store says is in flight. */
  savingKey?: string
  savedAt?: StationSettings['savedAt']
}) {
  const [settings, setSettings] = useState<Record<string, string>>({ firestation_latitude: stored })
  const [settingErrors, setSettingErrors] = useState<StationSettings['settingErrors']>({})
  const store: StationSettings = {
    settings,
    setSettings,
    serverSettings: { firestation_latitude: stored },
    loading: false,
    error: null,
    isSaving: (key) => key === savingKey,
    savedAt,
    settingErrors,
    setSettingErrors,
    reload: async () => {},
    updateSetting,
  }
  return <StationSettingsForm configs={CONFIGS} store={store} isEditor />
}

vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ refreshOperations: async () => {} }) }))

const field = () => document.getElementById('firestation_latitude') as HTMLInputElement

describe('StationSettingsForm – coordinates', () => {
  it('shows a stored 15-decimal coordinate with 6', () => {
    renderWithIntl(<Harness stored="47.51637699933488" updateSetting={vi.fn()} />)
    expect(field().value).toBe('47.516377')
  })

  it('shows what the operator types, and saves it rounded on blur', () => {
    const updateSetting = vi.fn(async () => {})
    renderWithIntl(<Harness stored="47.516377" updateSetting={updateSetting} />)
    fireEvent.change(field(), { target: { value: '47,5200004999' } })
    expect(field().value).toBe('47,5200004999')
    fireEvent.blur(field())
    expect(updateSetting).toHaveBeenCalledWith('firestation_latitude', '47.520000')
    expect(field().value).toBe('47.520000')
  })

  it('sends nothing when the rounded value is what the server has', () => {
    const updateSetting = vi.fn(async () => {})
    renderWithIntl(<Harness stored="47.516377" updateSetting={updateSetting} />)
    fireEvent.blur(field())
    expect(updateSetting).not.toHaveBeenCalled()
  })

  it('still names a typo instead of rounding it away', () => {
    const updateSetting = vi.fn(async () => {})
    renderWithIntl(<Harness stored="47.516377" updateSetting={updateSetting} />)
    fireEvent.change(field(), { target: { value: '47.5N' } })
    fireEvent.blur(field())
    expect(updateSetting).not.toHaveBeenCalled()
    expect(screen.getByText(/Zahl/)).toBeInTheDocument()
  })
})

/**
 * Owner pick UX-05 A (10.11.2026): a setting saves by itself, so the server's confirmation is
 * said under the field – the words of the Einsatz detail – and goes quiet again.
 */
describe('StationSettingsForm – «Synchronisiert»', () => {
  it('says «Wird synchronisiert …» while the save is out', () => {
    renderWithIntl(<Harness stored="47.516377" updateSetting={vi.fn()} savingKey="firestation_latitude" />)
    expect(screen.getByRole('status')).toHaveTextContent('Wird synchronisiert …')
  })

  it('says when the server confirmed, then goes quiet', () => {
    vi.useFakeTimers()
    try {
      const at = new Date()
      renderWithIntl(<Harness stored="47.516377" updateSetting={vi.fn()} savedAt={{ firestation_latitude: at }} />)
      expect(screen.getByRole('status')).toHaveTextContent(/^Synchronisiert – \d\d:\d\d$/)
      act(() => void vi.advanceTimersByTime(6_000))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing for a setting nobody touched', () => {
    renderWithIntl(<Harness stored="47.516377" updateSetting={vi.fn()} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

// Sweep 25.11.2026: two settings saving at once shared one flag, so the first to finish
// re-enabled the other key's input while its PATCH was still out.
describe('useStationSettings – saving per key', () => {
  it('keeps the second key saving when the first one finishes', async () => {
    const answers = new Map<string, () => void>()
    vi.spyOn(apiClient, 'updateSetting').mockImplementation(
      (key, value) => new Promise((resolve) => answers.set(key, () => resolve({ key, value }))),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">{children}</NextIntlClientProvider>
    )
    const { result } = renderHook(() => useStationSettings({ enabled: false, canEdit: true }), { wrapper })

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.updateSetting('printer.ip', '10.0.0.5')
      void result.current.updateSetting('printer.port', '9100')
    })
    expect(result.current.isSaving('printer.ip')).toBe(true)
    expect(result.current.isSaving('printer.port')).toBe(true)

    await act(async () => {
      answers.get('printer.ip')?.()
      await first
    })
    expect(result.current.isSaving('printer.ip')).toBe(false)
    expect(result.current.isSaving('printer.port')).toBe(true)
  })
})

describe('useSettingSaver – saving per key', () => {
  it('keeps a key saving while a second save of it is still out', async () => {
    const answers: Array<() => void> = []
    vi.spyOn(apiClient, 'updateSetting').mockImplementation(
      (key, value) => new Promise((resolve) => answers.push(() => resolve({ key, value }))),
    )
    const { result } = renderHook(() => useSettingSaver('Fehler'))

    let first: Promise<boolean> = Promise.resolve(true)
    let second: Promise<boolean> = Promise.resolve(true)
    act(() => {
      first = result.current.save('rank_abbreviations', '{"Kpl":"K"}')
      second = result.current.save('rank_abbreviations', '{"Kpl":"Kp"}')
    })
    await act(async () => {
      answers[0]()
      await first
    })
    expect(result.current.isSaving('rank_abbreviations')).toBe(true)

    await act(async () => {
      answers[1]()
      await second
    })
    expect(result.current.isSaving('rank_abbreviations')).toBe(false)
  })
})

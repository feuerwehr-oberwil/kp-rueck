import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'

import { StationSettingsForm, type SettingConfig, type StationSettings } from '@/components/settings/station-settings-form'
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
  saving = null,
  savedAt = {},
}: {
  stored: string
  updateSetting: StationSettings['updateSetting']
  saving?: StationSettings['saving']
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
    saving,
    savedAt,
    settingErrors,
    setSettingErrors,
    reload: async () => {},
    updateSetting,
  }
  return <StationSettingsForm configs={CONFIGS} store={store} isEditor />
}

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
describe('StationSettingsForm – «Gespeichert»', () => {
  it('says «Wird gespeichert …» while the save is out', () => {
    renderWithIntl(<Harness stored="47.516377" updateSetting={vi.fn()} saving="firestation_latitude" />)
    expect(screen.getByRole('status')).toHaveTextContent('Wird gespeichert …')
  })

  it('says when the server confirmed, then goes quiet', () => {
    vi.useFakeTimers()
    try {
      const at = new Date()
      renderWithIntl(<Harness stored="47.516377" updateSetting={vi.fn()} savedAt={{ firestation_latitude: at }} />)
      expect(screen.getByRole('status')).toHaveTextContent(/^Gespeichert – \d\d:\d\d$/)
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

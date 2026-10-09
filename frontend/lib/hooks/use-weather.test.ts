import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ getWeather: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { getWeather: mocks.getWeather } }))

import { useWeather } from './use-weather'

const DEVICE_NOW = Date.parse('2026-10-08T17:20:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(DEVICE_NOW)
  mocks.getWeather.mockReset()
})
afterEach(() => vi.useRealTimers())

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useWeather', () => {
  it('reports the backend clock, not the device clock', async () => {
    // Device 10 min behind the server.
    mocks.getWeather.mockResolvedValue({ enabled: true, generated_at: '2026-10-08T17:30:00Z', radar: null, warnings: null })
    const { result } = renderHook(() => useWeather())
    await flush()
    expect(result.current.now).toBe(Date.parse('2026-10-08T17:30:00Z'))
  })

  it('stops polling once the deployment says weather is off', async () => {
    mocks.getWeather.mockResolvedValue({ enabled: false, station_configured: false, generated_at: null, radar: null, warnings: null })
    renderHook(() => useWeather())
    await flush()
    expect(mocks.getWeather).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(5 * 60_000) })
    expect(mocks.getWeather).toHaveBeenCalledTimes(1)
  })

  it('keeps polling while enabled', async () => {
    mocks.getWeather.mockResolvedValue({ enabled: true, generated_at: '2026-10-08T17:20:00Z', radar: null, warnings: null })
    renderHook(() => useWeather())
    await flush()
    await act(async () => { vi.advanceTimersByTime(2 * 60_000) })
    expect(mocks.getWeather).toHaveBeenCalledTimes(3)
  })
})

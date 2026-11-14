import { describe, expect, it, vi } from 'vitest'
import { FIX_MAX_AGE_MS, FIX_TIMEOUT_MS, getDevicePosition } from './device-position'

/** A geolocation that answers `getCurrentPosition` with `answer`. */
function geolocation(answer: (ok: PositionCallback, fail: PositionErrorCallback) => void) {
  const getCurrentPosition = vi.fn(
    (ok: PositionCallback, fail?: PositionErrorCallback | null, _options?: PositionOptions) => answer(ok, fail!),
  )
  return { getCurrentPosition } as unknown as Geolocation & { getCurrentPosition: typeof getCurrentPosition }
}

const failingWith = (code: number) =>
  geolocation((_, fail) => fail({ code, message: '' } as GeolocationPositionError))

describe('getDevicePosition', () => {
  it('returns the fix with its accuracy, asked for once at high accuracy', async () => {
    const geo = geolocation((ok) =>
      ok({ coords: { latitude: 47.51, longitude: 7.56, accuracy: 8 } } as GeolocationPosition),
    )
    await expect(getDevicePosition({}, geo)).resolves.toEqual({ ok: true, lat: 47.51, lon: 7.56, accuracy: 8 })
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(geo.getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      timeout: FIX_TIMEOUT_MS,
      maximumAge: FIX_MAX_AGE_MS,
    })
  })

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ])('maps browser error %i to «%s»', async (code, reason) => {
    await expect(getDevicePosition({}, failingWith(code))).resolves.toEqual({ ok: false, reason })
  })

  it('says «unsupported» without geolocation, and never rejects when the browser throws', async () => {
    await expect(getDevicePosition({}, undefined)).resolves.toEqual({ ok: false, reason: 'unsupported' })
    const throwing = geolocation(() => {
      throw new Error('blocked')
    })
    await expect(getDevicePosition({}, throwing)).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })
})

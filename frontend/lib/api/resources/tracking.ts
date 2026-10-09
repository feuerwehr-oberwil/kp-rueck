/**
 * Traccar status, vehicle positions/trails and the weather layer.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { getApiUrl } from '../../env'
import type { ApiWeather } from '../../weather'
import { request as httpRequest } from '../http'
import type { ApiTraccarStatus, ApiVehiclePosition, ApiVehicleTrail } from '../types'

export class TrackingApi {
  // Traccar GPS Tracking
  async getTraccarStatus(): Promise<ApiTraccarStatus> {
    return httpRequest<ApiTraccarStatus>('/api/traccar/status')
  }

  // Weather layer (radar + official warnings at the station). Silent: it is an optional
  // overlay, and a feed or backend hiccup must never toast over the map – the layer shows its
  // own «Stand hh:mm» instead. One try, no retries: the next poll is a minute away anyway.
  async getWeather(viewerToken?: string): Promise<ApiWeather> {
    const query = viewerToken ? `?token=${encodeURIComponent(viewerToken)}` : ''
    return httpRequest<ApiWeather>(`/api/weather/${query}`, { skipToast: true, maxRetries: 0 })
  }

  /** A radar frame's PNG. Public and immutable on the backend, so MapLibre may load it as a
   *  plain image (no session cookie needed, cached for good by the browser). */
  weatherRadarFrameUrl(key: string): string {
    return `${getApiUrl()}/api/weather/radar/${encodeURIComponent(key)}.png`
  }

  async getVehiclePositions(): Promise<ApiVehiclePosition[]> {
    return httpRequest<ApiVehiclePosition[]>('/api/traccar/positions', {
      skipToast: true,
    })
  }

  async getVehicleTrails(minutes: number = 30): Promise<ApiVehicleTrail[]> {
    return httpRequest<ApiVehicleTrail[]>(`/api/traccar/trails?minutes=${minutes}`, {
      skipToast: true,
    })
  }
}

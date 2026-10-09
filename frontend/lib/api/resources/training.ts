/**
 * Übungssteuerung: generated emergencies, simulations and GPS drives.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  ApiGpsSimDrive,
  ApiIncident,
  ApiRekoReportResponse,
  ApiEmergencyTemplate,
  ApiTrainingLocation,
  ApiSimulatedRapport,
  ApiSimulatedRapportBulk,
  ApiDiveraEmergency,
} from '../types'

export class TrainingApi {
  // Training Automation
  async generateTrainingEmergency(
    eventId: string,
    request: { category?: 'normal' | 'critical' | null; count?: number; source?: 'operator' | 'intake' }
  ): Promise<ApiIncident[]> {
    return httpRequest<ApiIncident[]>(`/api/training/events/${eventId}/generate/`, {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async getEmergencyTemplates(category?: string): Promise<ApiEmergencyTemplate[]> {
    const params = category ? `?category=${encodeURIComponent(category)}` : ''
    return httpRequest<ApiEmergencyTemplate[]>(`/api/training/templates/${params}`)
  }

  async getTrainingLocations(): Promise<ApiTrainingLocation[]> {
    return httpRequest<ApiTrainingLocation[]>('/api/training/locations/')
  }

  async manualDispatch(
    eventId: string,
    templateId: string,
    location:
      | { kind: 'seeded'; locationId: string }
      | { kind: 'pin'; latitude: number; longitude: number; address: string },
  ): Promise<ApiIncident> {
    const body: Record<string, unknown> = { template_id: templateId }
    if (location.kind === 'seeded') {
      body.location_id = location.locationId
    } else {
      body.latitude = location.latitude
      body.longitude = location.longitude
      body.address = location.address
    }
    return httpRequest<ApiIncident>(`/api/training/events/${eventId}/dispatch/`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async simulateCheckin(
    eventId: string,
    count: number,
    overMinutes: number = 0
  ): Promise<{
    checked_in: string[]
    total_checked_in: number
    total_available: number
    scheduled?: string[]
    trickle_minutes?: number
  }> {
    return httpRequest(`/api/training/events/${eventId}/simulate/checkin`, {
      method: 'POST',
      body: JSON.stringify({ count, over_minutes: overMinutes }),
    })
  }

  /** Inject a simulated Divera alarm into the pool (training intake exercise).
   *
   * No caller since 2026-07-28 – the Übungssteuerung buttons were removed while
   * the recipient model is unresolved. Endpoint and generator still exist, so
   * restoring the UI is a small change once that model lands.
   */
  async simulateDiveraAlarm(
    eventId: string,
    category?: 'normal' | 'critical' | null
  ): Promise<ApiDiveraEmergency> {
    return httpRequest<ApiDiveraEmergency>(`/api/training/events/${eventId}/simulate/divera`, {
      method: 'POST',
      body: JSON.stringify({ category: category ?? null }),
    })
  }

  /** Inject "Lage verschärft sich": priority up + Lagemeldung + critical bell. */
  async simulateEscalation(eventId: string, incidentId: string): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/training/events/${eventId}/simulate/escalate/${incidentId}`, {
      method: 'POST',
    })
  }

  /** Inject "Feld fordert Verstärkung": bell notification only. */
  async simulateReinforcement(eventId: string, incidentId: string): Promise<{ message: string }> {
    return httpRequest<{ message: string }>(
      `/api/training/events/${eventId}/simulate/reinforcement/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject "Fahrzeug fällt aus": random assigned vehicle becomes unavailable. */
  async simulateVehicleBreakdown(
    eventId: string,
    incidentId: string
  ): Promise<{ vehicle_name: string; message: string }> {
    return httpRequest<{ vehicle_name: string; message: string }>(
      `/api/training/events/${eventId}/simulate/vehicle-breakdown/${incidentId}`,
      { method: 'POST' }
    )
  }

  async simulateReko(
    eventId: string,
    incidentId: string
  ): Promise<ApiRekoReportResponse> {
    return httpRequest<ApiRekoReportResponse>(`/api/training/events/${eventId}/simulate/reko/${incidentId}`, {
      method: 'POST',
    })
  }

  /** Mark the Reko crew as "vor Ort" (arrived) without submitting a report –
   *  the first of the two Reko conductor steps. */
  async simulateRekoArrived(
    eventId: string,
    incidentId: string
  ): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/training/events/${eventId}/simulate/reko-arrived/${incidentId}`, {
      method: 'POST',
    })
  }

  // GPS drive simulation (Übungssteuerung) – simulated positions feed the same
  // pipeline as real Traccar data (map, distances, arrival/return prompts).
  async getGpsSimulations(): Promise<ApiGpsSimDrive[]> {
    return httpRequest<ApiGpsSimDrive[]>('/api/training/gps-sim/')
  }

  async startGpsSimulation(body: {
    vehicle_id: string
    target: 'incident' | 'magazin'
    incident_id?: string
    speed_kmh?: number
  }): Promise<ApiGpsSimDrive> {
    return httpRequest<ApiGpsSimDrive>('/api/training/gps-sim/start', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  async setGpsSimulationSpeed(vehicleId: string, speedKmh: number): Promise<ApiGpsSimDrive> {
    return httpRequest<ApiGpsSimDrive>('/api/training/gps-sim/speed', {
      method: 'POST',
      body: JSON.stringify({ vehicle_id: vehicleId, speed_kmh: speedKmh }),
    })
  }

  async stopGpsSimulation(vehicleId?: string): Promise<{ stopped: number }> {
    return httpRequest<{ stopped: number }>('/api/training/gps-sim/stop', {
      method: 'POST',
      body: JSON.stringify({ vehicle_id: vehicleId ?? null }),
    })
  }

  /** Field crew reports the incident finished ("Einsatz beendet") – sets an
   *  informational badge for the operator; does NOT change status.
   *
   *  `pickupNeeded` is the follow-up the field gets ("Kommt ihr selbst
   *  zurück?"): omit it and the backend preselects it from the situation – a
   *  crew that walked there or whose vehicle drove on is usually stranded. */
  async simulateFieldComplete(
    eventId: string,
    incidentId: string,
    options?: { pickupNeeded?: boolean; pickupNote?: string }
  ): Promise<ApiIncident> {
    return httpRequest<ApiIncident>(`/api/training/events/${eventId}/simulate/field-complete/${incidentId}`, {
      method: 'POST',
      body: JSON.stringify({
        pickup_needed: options?.pickupNeeded ?? null,
        pickup_note: options?.pickupNote ?? null,
      }),
    })
  }

  /** Inject "Rapport eingetroffen": one filled and submitted Schadenplatz-Rapport. */
  async simulateRapport(eventId: string, incidentId: string): Promise<ApiSimulatedRapport> {
    return httpRequest<ApiSimulatedRapport>(
      `/api/training/events/${eventId}/simulate/rapport/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject "Rapporte eingetroffen": 80 % of the missing ones arrive at once.
   *  The remaining fifth stays missing on purpose – those gaps are the
   *  Restliste, and finding them is the exercise. */
  async simulateRapportsBulk(eventId: string): Promise<ApiSimulatedRapportBulk> {
    return httpRequest<ApiSimulatedRapportBulk>(`/api/training/events/${eventId}/simulate/rapport`, {
      method: 'POST',
    })
  }

  /** Inject "Meldung vom Feld": a chip or a typed sentence reaches the KP. */
  async simulateFieldMessage(eventId: string, incidentId: string): Promise<{ message: string }> {
    return httpRequest<{ message: string }>(
      `/api/training/events/${eventId}/simulate/field-message/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject «Neue Meldung»: the crew of `incidentId` reports a fresh emergency
   *  in free text. Goes through the real `/feld` creation path on the backend,
   *  so a genuine `source='feld'` Schadenplatz lands in Eingegangen — bell,
   *  audit provenance and all. Needs assigned personnel on the incident. */
  async simulateFieldReport(
    eventId: string,
    incidentId: string,
    text: string
  ): Promise<{ incident_id: string; reported_by: string; message: string }> {
    return httpRequest<{ incident_id: string; reported_by: string; message: string }>(
      `/api/training/events/${eventId}/simulate/field-report/${incidentId}`,
      { method: 'POST', body: JSON.stringify({ text }) }
    )
  }

  /** Inject "Angekommen": the crew reports it is on the Schadenplatz. Stamps
   *  `arrived_at` on the Schadenplatz-Rapport through the same CRUD the `/feld`
   *  button uses. A second call never moves an arrival that is already
   *  reported – the message says so instead. */
  async simulateFieldArrived(eventId: string, incidentId: string): Promise<{ message: string }> {
    return httpRequest<{ message: string }>(
      `/api/training/events/${eventId}/simulate/arrived/${incidentId}`,
      { method: 'POST' }
    )
  }

  /** Inject "Abholung nötig" / "Abholung disponiert" on its own – the crew that
   *  asks for a lift an hour after "Einsatz beendet", or reports the bus has
   *  been. Omit `note` and the backend derives one from the situation. */
  async simulatePickup(
    eventId: string,
    incidentId: string,
    options?: { needed?: boolean; note?: string }
  ): Promise<{ message: string }> {
    return httpRequest<{ message: string }>(
      `/api/training/events/${eventId}/simulate/pickup/${incidentId}`,
      {
        method: 'POST',
        body: JSON.stringify({ needed: options?.needed ?? true, note: options?.note ?? null }),
      }
    )
  }
}

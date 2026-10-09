/**
 * Duplicate reports — the client half of `backend/app/services/duplicates.py`.
 *
 * The server decides what counts as «probably the same Schadenplatz» (open
 * card, same Ereignis, ≤ 50 m or the same street + number). This module only
 * turns its answer into words and into the small «where is it» sketch, so the
 * hint reads the same in «Neuer Einsatz», the Alarmeingang and on `/feld`.
 */

import type { ApiDuplicateCandidate, ApiFeldDuplicateCandidate } from '@/lib/api-client'
import { formatDuration } from '@/lib/duration'

/** What the hint needs: `/feld`'s minimal candidate, plus the pin when the board's
 *  lookup carries one (only then is there anything to sketch). */
export type DuplicateHintCandidate = ApiFeldDuplicateCandidate &
  Partial<Pick<ApiDuplicateCandidate, 'location_lat' | 'location_lng'>>

/** Must match `DUPLICATE_RADIUS_M` in the backend: the sketch draws this circle. */
export const DUPLICATE_RADIUS_M = 50

/** Metres per degree of latitude (mean Earth radius). Plenty for 50 m. */
const M_PER_DEG = 111_195

/** The candidate's name on the hint: the short address, else the card title. */
export function candidateLabel(candidate: Pick<ApiDuplicateCandidate, 'location_display' | 'title'>): string {
  return candidate.location_display?.trim() || candidate.title
}

/** «40 m» / null for an address-only match (the hint then says «gleiche Adresse»). */
export function candidateDistance(candidate: Pick<ApiDuplicateCandidate, 'distance_m' | 'match'>): number | null {
  return candidate.match === 'address' ? null : candidate.distance_m
}

/** «6'» — how long the existing card has been on the board, board notation. */
export function candidateAge(createdAt: string, now: number = Date.now()): string {
  return formatDuration(Math.max(0, now - new Date(createdAt).getTime()))
}

/**
 * East/north offset in metres from `origin` to `point` — flat-earth, which is
 * exact enough inside a 50 m circle. Null when either side has no pin.
 */
export function offsetMetres(
  origin: { lat: number; lng: number } | null,
  point: { lat: string | number | null; lng: string | number | null },
): { east: number; north: number } | null {
  if (!origin || point.lat == null || point.lng == null || point.lat === '' || point.lng === '') return null
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    north: (lat - origin.lat) * M_PER_DEG,
    east: (lng - origin.lng) * M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180),
  }
}

/** The query the hint is asked with — or null when there is nothing to compare yet. */
export interface DuplicateQuery {
  eventId?: string
  lat: number | null
  lng: number | null
  address: string | null
  excludeId?: string | null
}

export function duplicateQueryKey(query: DuplicateQuery | null): string | null {
  if (!query) return null
  const hasPin = query.lat != null && query.lng != null
  const address = query.address?.trim() ?? ''
  // A street without a house number never matches on the server; asking is a wasted round trip.
  if (!hasPin && !/\d/.test(address)) return null
  return JSON.stringify([
    query.eventId ?? '',
    hasPin ? query.lat!.toFixed(6) : '',
    hasPin ? query.lng!.toFixed(6) : '',
    address,
    query.excludeId ?? '',
  ])
}

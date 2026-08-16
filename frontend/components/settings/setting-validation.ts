/**
 * Client-side validation for the free-text settings on the general page.
 *
 * Only the numeric ones need it, and only because of what they do: the station
 * coordinates centre the map for everybody in the command post. A typo there is
 * not a validation error the operator sees — it is a map that quietly opens over
 * the wrong village. `PATCH /api/settings/{key}` stores whatever string it is
 * handed, so the check has to happen here.
 */

/** An inclusive numeric range a setting's value has to fall into. */
export interface SettingRange {
  min: number
  max: number
}

/** Which message the caller should show; the copy itself lives in the catalogues. */
export type SettingValidationError = 'notANumber' | 'outOfRange'

/**
 * Validate a range-constrained setting. An empty value is valid: these settings
 * seed empty, and clearing one back to "not configured" is a legitimate edit.
 *
 * Accepts the German decimal comma as well as the dot — an operator pasting a
 * coordinate out of a Swiss spreadsheet gets `47,5164`, and rejecting that as
 * "keine Zahl" would be pedantry. The caller normalises before it saves.
 */
export function validateRangedSetting(value: string, range: SettingRange): SettingValidationError | null {
  const trimmed = value.trim()
  if (trimmed === '') return null

  const parsed = Number(normalizeDecimal(trimmed))
  if (!Number.isFinite(parsed)) return 'notANumber'
  if (parsed < range.min || parsed > range.max) return 'outOfRange'
  return null
}

/**
 * The string actually written to the setting: comma → dot, whitespace gone.
 * Everything downstream reads these with `parseFloat`, which stops at a comma.
 */
export function normalizeDecimal(value: string): string {
  return value.trim().replace(',', '.')
}

/** WGS84 bounds. Wider than Switzerland on purpose – the app is not Swiss-only. */
export const LATITUDE_RANGE: SettingRange = { min: -90, max: 90 }
export const LONGITUDE_RANGE: SettingRange = { min: -180, max: 180 }

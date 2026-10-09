/**
 * Backend errors that carry a stable `code` (backend/app/utils/error_codes.py),
 * said in the operator's language.
 *
 * The body is FastAPI's `{"detail": "<German sentence>"}` plus `code` (and
 * `params` for the few sentences with a number in them). The sentence for a
 * code lives in `errors.codes.<code>` of messages/<locale>.json; a code this
 * build does not know yet — a backend that is ahead — falls back to the German
 * `detail`, which is what every error said before codes existed. So the worst
 * case is the old behaviour, never an empty or raw-key toast.
 */
import { getActiveLocale, loadMessages, translateOutsideReact } from '@/lib/i18n-messages'

/** The localized sentence for this error body, or `null` when it has no code this build knows. */
export function messageForErrorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const { code, params } = body as { code?: unknown; params?: unknown }
  if (typeof code !== 'string' || !/^[a-z0-9_]+$/.test(code)) return null
  const known = (loadMessages(getActiveLocale()).errors as { codes?: Record<string, string> }).codes
  if (!known || typeof known[code] !== 'string') return null
  const values: Record<string, string | number> = {}
  if (typeof params === 'object' && params !== null) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' || typeof value === 'number') values[key] = value
    }
  }
  return translateOutsideReact(`errors.codes.${code}`, values)
}

/** The `code` of an error body, if it has one. */
export function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { code } = body as { code?: unknown }
  return typeof code === 'string' ? code : undefined
}

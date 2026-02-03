/**
 * Logging utility that avoids triggering Next.js error overlay
 *
 * Next.js 15 shows console.error in the error overlay during development.
 * For expected errors (network issues, API errors), we use console.warn instead.
 */

/**
 * Log an expected error (won't trigger Next.js error overlay)
 * Use for: network errors, API errors, validation errors
 */
export function logExpectedError(context: string, error?: unknown): void {
  if (process.env.NODE_ENV === 'development') {
    // Use console.warn to avoid Next.js error overlay
    console.warn(`[${context}]`, error instanceof Error ? error.message : error)
  } else {
    // In production, use console.error for proper error tracking
    console.error(`[${context}]`, error)
  }
}

/**
 * Log an unexpected error (will trigger Next.js error overlay in dev)
 * Use for: programming errors, bugs, unexpected states
 */
export function logUnexpectedError(context: string, error: unknown): void {
  console.error(`[${context}]`, error)
}

/**
 * Silently ignore an error (no logging)
 * Use for: intentionally ignored errors like network failures during initial load
 */
export function ignoreError(_error?: unknown): void {
  // Intentionally empty - error is ignored
}

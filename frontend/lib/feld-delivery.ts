/**
 * Delivery state for the four `/feld` reports (plan 25).
 *
 * A phone at a Schadenplatz is on the worst connection in the operation. A tap
 * that quietly does nothing is therefore the *expected* case, not the exotic
 * one — and until now the only feedback was a spinner that vanished, which
 * looks exactly the same whether the KP got the Meldung or not.
 *
 * Kept as a pure reducer so the part that matters — a failure never loses what
 * was typed, and a stale answer never overwrites a newer attempt — is testable
 * without a phone, a network, or a DOM.
 */

export type FeldActionKind = 'arrived' | 'complete' | 'pickup' | 'message'

export type DeliveryState =
  | { status: 'idle' }
  | { status: 'pending'; action: FeldActionKind; label: string; attempt: number }
  | { status: 'sent'; action: FeldActionKind; label: string; attempt: number }
  | { status: 'failed'; action: FeldActionKind; label: string; attempt: number }

export type DeliveryEvent =
  | { type: 'send'; action: FeldActionKind; label: string; attempt: number }
  | { type: 'settled'; ok: boolean; attempt: number }
  | { type: 'clear' }

export const IDLE: DeliveryState = { status: 'idle' }

/**
 * ``attempt`` is what makes a retry safe on a flaky link: a first request that
 * finally times out *after* the crew already hit "Nochmals senden" must not turn
 * the second attempt's spinner into a red error. Answers that do not belong to
 * the attempt on screen are dropped.
 *
 * It is supplied by the caller and never derived here. This reducer used to
 * compute it — ``state.status === 'idle' ? 1 : state.attempt + 1`` — which made
 * a *second* counter alongside the caller's, and the two came apart the moment
 * anything cleared the state. The green receipt clears itself after six
 * seconds, so on the second report of a shift the reducer numbered the attempt 1
 * while the caller settled it as 2; the answer was then discarded as stale and
 * "wird gesendet…" stayed on screen for good, with all four buttons locked,
 * over a request that had already succeeded. One counter, owned by whoever
 * actually fires the requests.
 */
export function deliveryReducer(state: DeliveryState, event: DeliveryEvent): DeliveryState {
  switch (event.type) {
    case 'send':
      return { status: 'pending', action: event.action, label: event.label, attempt: event.attempt }
    case 'settled': {
      if (state.status !== 'pending' || state.attempt !== event.attempt) return state
      return {
        status: event.ok ? 'sent' : 'failed',
        action: state.action,
        label: state.label,
        attempt: state.attempt,
      }
    }
    case 'clear':
      return IDLE
    default:
      return state
  }
}

/** True while a request is in flight — the buttons lock, nothing else does. */
export function isBusy(state: DeliveryState, action?: FeldActionKind): boolean {
  return state.status === 'pending' && (action === undefined || state.action === action)
}

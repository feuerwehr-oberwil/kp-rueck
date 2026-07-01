/**
 * Pure decision logic for the "undo delete" restore flow, extracted from the
 * operations context so it can be unit-tested in isolation (mirrors how
 * `lib/sync-cooldown.ts` keeps its decision logic pure and tested).
 *
 * The operations context normalizes the outcome of a restore API call into one
 * of the `RestoreOutcome` values and asks this function what to do.
 */

/** Normalized outcome of a restore API attempt. */
export type RestoreOutcome =
  | "ok" // restore succeeded, incident returned
  | "conflict" // 409 — incident already restored (idempotent, harmless)
  | "network" // api-client returned undefined (network error, swallowed)
  | "error" // any other failure

/** What the caller should do in response to a restore attempt. */
export type RestoreAction =
  | "refresh-success" // reload the board + show the "wiederhergestellt" toast
  | "refresh-silent" // reload the board, no toast (already restored elsewhere)
  | "error" // show the "fehlgeschlagen" toast, don't reload

export function decideRestoreAction(outcome: RestoreOutcome): RestoreAction {
  switch (outcome) {
    case "ok":
      return "refresh-success"
    case "conflict":
      // A second click on the undo toast (or another client restoring first)
      // 409s — treat it as success and reconcile the board without a toast.
      return "refresh-silent"
    case "network":
    case "error":
      return "error"
  }
}

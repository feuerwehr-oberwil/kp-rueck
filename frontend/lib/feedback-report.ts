// Builds the Fehlerbericht an operator hands over. Nothing here talks to the network.
//
// The app used to POST this to the maintainer's ingest. That ingest was retired (PRIVACY.md
// § «Where it goes»), so there is nothing left to POST to — and a report queued for a
// destination that does not exist is worse than no route at all, because the card says
// «gesendet» and nothing ever arrives. What replaced it is these two URLs: the operator picks
// a route, the app fills in the form or the mail, and a human is the transport.
//
// The technical block is composed in the component, from the same copy keys that render it on
// screen, and passed in here. That is deliberate: the block the operator READ and the block
// that travels are one string, so they cannot drift.

/** Where a Fehlerbericht can go. Both are the maintainer's; a station that triages internally
 *  overrides `mailto` with its own address and can blank `github` to hide that route entirely
 *  (the card then offers mail only). */
export const feedbackConfig = {
  mailto: 'bastian.eichenberger@feuerwehr-oberwil.ch',
  // The issue form is the route that can demand structure — required fields, a version, the
  // Diagnose-Datei — which a free-text mail cannot. Hence «empfohlen» on the card.
  github: 'https://github.com/feuerwehr-oberwil/kp-rueck',
} as const

/** Which way the report leaves. */
export type FeedbackRoute = 'github' | 'mail'

export interface ReportDraft {
  /** What the operator typed. May be empty — they can send just the technical block. */
  message: string
  /** The technical block, verbatim as shown above the routes. */
  tech: string
  /** Build label, e.g. `v0.7.0`. Its own required field in the issue form. */
  version: string
}

/** The full report: the operator's words first — that is the part a human reads — then the
 *  technical block, separated by the usual signature marker. */
export function buildReport(draft: ReportDraft, noDescription: string): string {
  return `${draft.message.trim() || noDescription}\n\n--\n${draft.tech}\n`
}

/** `mailto:` URL. Kept pure so the encoding is testable — a raw newline or an unencoded `&`
 *  in the body silently truncates the mail in some clients. */
export function mailtoUrl(address: string, subject: string, body: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** How much of the report travels in a URL. GitHub redirects a prefilled issue link through
 *  its login flow, and a URL that survives the browser can still be refused there — so the
 *  query carries the short block and the Diagnose-Datei carries the rest, which is the
 *  division of labour the card explains to the operator anyway. */
const MAX_PREFILL = 1200

/** Prefilled `new issue` URL against the bug-report FORM
 *  (`.github/ISSUE_TEMPLATE/bug_report.yml`). The query keys are the form's field ids —
 *  `what`, `version`, `diagnostics` — and GitHub silently ignores a key that matches no
 *  field, so a renamed field degrades to an empty box rather than an error.
 *
 *  `repo` is the base repository URL; a deployment that blanks it has no GitHub route and the
 *  card does not offer one. */
export function githubIssueUrl(repo: string, draft: ReportDraft): string {
  const q = new URLSearchParams({
    template: 'bug_report.yml',
    what: draft.message.trim().slice(0, MAX_PREFILL),
    version: draft.version,
    diagnostics: draft.tech.slice(0, MAX_PREFILL),
  })
  return `${repo.replace(/\/+$/, '')}/issues/new?${q}`
}

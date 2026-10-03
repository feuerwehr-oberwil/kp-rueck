/**
 * Which build this is — ONE label for every place Rück shows its version (user menu, Mehr
 * sheet, help page, problem report) and the id the «Neue Version verfügbar» check compares.
 *
 * Stamped at build time in next.config.mjs. Same shape as KP Front's `buildLabel()`:
 * «v0.7.0 · 1a2b3c4 · 03.10.2026», the commit only when the build knew it.
 */

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"
export const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? ""
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? ""

/** Unique per build — version alone repeats across deploys, the time does not. */
export const BUILD_ID = [APP_VERSION, GIT_SHA, BUILD_TIME].join("@")

export function buildLabel(
  info: { version: string; sha: string; time: string } = { version: APP_VERSION, sha: GIT_SHA, time: BUILD_TIME },
): string {
  const date = info.time ? new Date(info.time) : null
  const day =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" })
      : ""
  return [`v${info.version}`, info.sha, day].filter(Boolean).join(" · ")
}

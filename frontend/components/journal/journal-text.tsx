"use client"

/**
 * One journal row as a sentence in the reader's language. The automatic rows carry
 * facts (`kind` + `data`), not sentences; this is where they become words.
 *
 * Used by the Verlauf drawer (`journal-sheet.tsx`) and by an incident's Chronik
 * (`components/kanban/incident-timeline.tsx`), which shows the same rows for one card –
 * so a field fact reads the same in both places.
 */

import { useTranslations } from "next-intl"

import type { ApiJournalEntry } from "@/lib/api-client"
import { isIncidentStatus } from "@/lib/types/incidents"

/** What a row needs to be said: the Chronik hands over just these. */
export type JournalFact = Pick<ApiJournalEntry, "kind" | "data"> & Partial<Pick<ApiJournalEntry, "author_name">>

/** Field facts the drawer has words for (`data.type`); anything else shows its text. */
const FIELD_TYPES = new Set([
  "field_arrived",
  "field_arrived_cleared",
  "field_complete",
  "field_complete_cleared",
  "field_pickup_requested",
  "field_pickup_cleared",
  "rapport_submitted",
  "reko_arrived",
  "reko_arrived_cleared",
  // a request from the field (R13) changing state; the text is the request's label
  "field_request_in_progress",
  "field_request_done",
  "field_request_open",
  // a request that moved with a merge (R2 × R13) — «übernommen von …» / «zurück von …»
  "field_request_moved",
  "field_request_returned",
  // the crew's own «Wir fahren selbst» (23.11.2026) – never the KP's «Abholung erledigt»
  "field_pickup_self",
  // a card the crew reported on /feld (the Chronik builds this row, the journal does not)
  "field_reported",
  // vehicle facts a bell announced; the text is the vehicle (backend services/vehicle_facts)
  "vehicle_on_site",
  "vehicle_returned",
  "vehicle_down",
  // the Übung's «Lage verschärft»; the text is the Lagemeldung (backend api/training_simulate)
  "situation_escalated",
])

/** Who besides the crew reported a fact: the KP from the radio, the GPS, the Übung. */
const SOURCE_LABEL = { kp: "sourceKp", gps: "sourceGps", training: "sourceTraining" } as const

function isSource(source: string): source is keyof typeof SOURCE_LABEL {
  return source in SOURCE_LABEL
}

/** A row in the reader's language. The automatic rows carry facts, not sentences. */
export function JournalText({ entry, text }: { entry: JournalFact; text: string | null }) {
  const t = useTranslations("journal.rows")
  const tStatus = useTranslations("kanban")
  const data = (entry.data ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "")
  const status = (s: string) => (isIncidentStatus(s) ? tStatus(`columns.${s}`) : s)

  switch (entry.kind) {
    case "incident": {
      const action = str("action")
      if (action === "deleted") return <span>{t("deleted")}</span>
      if (action === "restored") return <span>{t("restored")}</span>
      // The merged card's work moving over (owner decision 10.10.2026): what, from where.
      if (action === "items_moved" || action === "items_returned") {
        const other = str("other_title") || t("unknown")
        return (
          <span>
            {t(action === "items_moved" ? "itemsMoved" : "itemsReturned", { other })}
            {text ? `: ${text}` : ""}
          </span>
        )
      }
      if (action === "merge" || action === "merged_into" || action === "unmerge") {
        return <span>{t(action === "merged_into" ? "mergedInto" : action, { other: str("other_title") || t("unknown") })}</span>
      }
      return <span>{t("created")}</span>
    }
    case "field": {
      const type = str("type")
      // `other` only means something to the moved/returned rows; the others ignore it.
      const label = FIELD_TYPES.has(type) ? t(`field.${type}`, { other: str("other_title") || t("unknown") }) : null
      if (!label) return <span>{text}</span>
      const source = str("source")
      return (
        <span>
          {label}
          {text ? `: ${text}` : ""}
          {isSource(source) ? <span className="text-muted-foreground"> ({t(SOURCE_LABEL[source])})</span> : null}
        </span>
      )
    }
    case "status":
      return (
        <span>
          <span className="text-muted-foreground">{status(str("from_status"))} → </span>
          <span className="font-medium">{status(str("to_status"))}</span>
        </span>
      )
    case "assignment":
      return (
        <span className={str("action") === "unassigned" ? "text-muted-foreground" : undefined}>
          {t(str("action") === "unassigned" ? "unassigned" : "assigned", { name: str("resource_name") })}
        </span>
      )
    case "reko":
      return <span>{text ? t("rekoWith", { text }) : t("reko")}</span>
    case "alarm":
      return (
        <span>
          {typeof data.recipients === "number" && data.recipients > 0
            ? t("alarm", { count: data.recipients })
            : t("alarmPlain")}
        </span>
      )
    case "message":
      return (
        <span>
          <span className="font-medium">
            {t(str("direction") === "to_field" ? "toField" : "fromField", { name: entry.author_name ?? t("unknown") })}
          </span>{" "}
          {text}
        </span>
      )
    default:
      return <span>{text}</span>
  }
}

import type { ApiJournalEntry } from "@/lib/api/types/journal"
import type { OperationDetailSection, OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"

/**
 * Which tab (and block) of the Einsatz-Detail a pointer opens – for every pointer that is about
 * ONE fact of an Einsatz and is not a notification (the bell has its own table,
 * `notification-detail-tab.ts`).
 *
 * The rule: open the tab that SHOWS the fact the pointer names. A pointer that names no fact
 * (a click on the card as a whole, ⌘K, a map marker) passes no target and gets the tab that
 * Einsatz was last left on. A target is never written back to that memory.
 *
 * Used by: the sidebar bindings and Dienstzeiten «Jetzt» (person/device → its role), the
 * Fahrzeugstatus rows, «Geräte vor Ort», Kennzahlen, the Verlauf chips – and the phone Einsatz
 * sheet, which has no tabs and scrolls to the matching block instead (`phoneSheetBlock`).
 */
export interface DetailTarget {
  tab: OperationDetailTab
  section?: OperationDetailSection
}

/** What the Einsatz is: Übersicht from its top. */
export const OVERVIEW_TARGET: DetailTarget = { tab: "overview" }
/** Who and what is on it: Übersicht's Ressourcen block (crew, vehicles, material). */
export const RESOURCES_TARGET: DetailTarget = { tab: "overview", section: "resources" }
/** The Reko: Reko-Zuweisung, «Reko vor Ort», the Reko-Berichte. */
export const REKO_TARGET: DetailTarget = { tab: "reko" }
/** Everything from the Schadenplatz: Feldmeldungen, the message thread, the Rapport and its
 *  «Vor Ort verblieben» material. Opened to READ – no caret in the Kurzbericht. */
export const FELD_TARGET: DetailTarget = { tab: "rapport" }
/** Chronik: status changes, assignments incl. released ones, merges. */
export const HISTORY_TARGET: DetailTarget = { tab: "history" }

/** Incident-row actions whose fact is a merge or what moved with one – Chronik shows the merge. */
const MERGE_ACTIONS = new Set(["merge", "merged_into", "unmerge", "items_moved", "items_returned"])

/**
 * The tab a Verlauf (journal) row's Einsatz chip opens. `undefined` = no tab shows this fact
 * (a KP-Journal line, an alarm), so the chip opens the remembered tab.
 */
export function detailTargetForJournalEntry(entry: Pick<ApiJournalEntry, "kind" | "data">): DetailTarget | undefined {
  const data = entry.data ?? {}
  const str = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "")
  switch (entry.kind) {
    case "reko":
      return REKO_TARGET
    case "field":
      // «Reko vor Ort» is a toggle on the Reko tab; everything else the field reports is Feld.
      return str("type").startsWith("reko_arrived") ? REKO_TARGET : FELD_TARGET
    case "message":
      return FELD_TARGET
    case "assignment":
      // A released resource is gone from Übersicht; Chronik still lists who was here.
      return str("action") === "unassigned" ? HISTORY_TARGET : RESOURCES_TARGET
    case "status":
      return HISTORY_TARGET
    case "incident":
      return MERGE_ACTIONS.has(str("action")) ? HISTORY_TARGET : OVERVIEW_TARGET
    case "manual":
    case "alarm":
      return undefined
  }
}

/** A block of the phone Einsatz sheet (`MobileIncidentDetailSheet`) a target can land on. */
export type PhoneSheetBlock = "reko" | "resources"

/**
 * Where the phone sheet scrolls for a target. The sheet is one read-only scroll without tabs:
 * Reko → the Reko-Bericht, a resources target → the resource lists. `null` = the sheet's top
 * (Übersicht, Chronik, and Feld, which the phone sheet does not show).
 */
export function phoneSheetBlock(target: DetailTarget | undefined | null): PhoneSheetBlock | null {
  if (!target) return null
  if (target.tab === "reko") return "reko"
  if (target.section === "resources") return "resources"
  return null
}

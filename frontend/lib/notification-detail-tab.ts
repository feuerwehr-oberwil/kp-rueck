import { OPERATION_DETAIL_TABS, type OperationDetailTab } from "@/lib/hooks/use-operation-detail-shortcuts"

/**
 * Which tab of the incident detail a notification is about.
 *
 * Clicking "Rapport erfasst: Hauptstrasse 1" used to open the detail on
 * Übersicht — the operator was told about one specific thing and then had to go
 * and find it. The bell is a pointer; it should point.
 *
 * The map is deliberately partial, and everything absent from it lands on
 * Übersicht. A wrong guess costs more than the default does: it drops the
 * operator on a panel that answers a question they did not ask, and unlike the
 * default it does not look like a default.
 */
const TAB_BY_TYPE: Record<string, OperationDetailTab> = {
  // Everything the field sends. Since §18.7b these all read on one surface:
  // the Feldmeldungen toggles, the message thread and the Schadenplatz-Rapport.
  rapport_submitted: "rapport",
  field_message: "rapport",
  field_arrived: "rapport",
  field_complete: "rapport",
  field_pickup: "rapport",
  // Reko has a tab of its own again: the Reko-Berichte are written and read at a
  // different moment than everything the crew sends from the Schadenplatz, and
  // one tab holding both was one tab nobody could see the end of.
  reko_submitted: "reko",
  reko_arrived: "reko",
  // Resources, timings and data quality are all Übersicht — but they are listed
  // rather than left to the fallback, so the next reader can see that the
  // classification was made and not merely omitted.
  time_overdue: "overview",
  no_personnel: "overview",
  no_materials: "overview",
  fatigue_warning: "overview",
  personnel_fatigue: "overview",
  missing_location: "overview",
  vehicle_arrived: "overview",
  vehicle_returned: "overview",
}

/**
 * The tab to open for this notification type — always a real tab.
 *
 * A type nobody has classified yet (a new one from a backend that is ahead of
 * this build) falls back silently, which is the whole point of a fallback.
 */
export function detailTabForNotification(type: string | undefined | null): OperationDetailTab {
  const tab = type ? TAB_BY_TYPE[type] : undefined
  return tab && OPERATION_DETAIL_TABS.includes(tab) ? tab : "overview"
}

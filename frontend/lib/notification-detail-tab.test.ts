import { describe, expect, it } from "vitest"

import { detailTabForNotification } from "@/lib/notification-detail-tab"
import { OPERATION_DETAIL_TABS } from "@/lib/hooks/use-operation-detail-shortcuts"

describe("detailTabForNotification", () => {
  it("sends everything the field reports to the Rapport tab", () => {
    // Since §18.7b the Feldmeldungen, the message thread and the
    // Schadenplatz-Rapport are one surface — so all five field types land there.
    for (const type of ["rapport_submitted", "field_message", "field_arrived", "field_complete", "field_pickup"]) {
      expect(detailTabForNotification(type)).toBe("rapport")
    }
  })

  it("sends Reko to the Reko tab, which it has again", () => {
    expect(detailTabForNotification("reko_submitted")).toBe("reko")
    expect(detailTabForNotification("reko_arrived")).toBe("reko")
  })

  it("sends resource, timing and data-quality alerts to Übersicht", () => {
    for (const type of [
      "time_overdue",
      "no_personnel",
      "no_materials",
      "fatigue_warning",
      "missing_location",
      "vehicle_arrived",
      "vehicle_returned",
    ]) {
      expect(detailTabForNotification(type)).toBe("overview")
    }
  })

  it("falls back to Übersicht for anything it cannot classify", () => {
    // A backend ahead of this build, or no type at all. A wrong guess drops the
    // operator on a panel answering a question they did not ask; the default at
    // least looks like a default.
    expect(detailTabForNotification("etwas_ganz_neues")).toBe("overview")
    expect(detailTabForNotification(undefined)).toBe("overview")
    expect(detailTabForNotification(null)).toBe("overview")
    expect(detailTabForNotification("")).toBe("overview")
  })

  it("only ever names a tab that exists", () => {
    for (const type of ["rapport_submitted", "time_overdue", "unbekannt"]) {
      expect(OPERATION_DETAIL_TABS).toContain(detailTabForNotification(type))
    }
  })
})

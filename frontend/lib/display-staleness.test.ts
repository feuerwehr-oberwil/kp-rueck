import { describe, expect, it } from "vitest";

import {
  DISPLAY_STALE_ALERT_MS,
  DISPLAY_STALE_WARN_MS,
  displayStaleLevel,
} from "@/lib/display-staleness";

const NOW = new Date("2026-07-30T02:10:00.000Z");
const agoMs = (ms: number) => new Date(NOW.getTime() - ms);

describe("displayStaleLevel", () => {
  it("is fresh before anything has loaded", () => {
    // The loading state owns this case; a banner here would flash on every page open.
    expect(displayStaleLevel({ lastRefresh: null, now: NOW })).toBe("fresh");
  });

  it("is fresh across normal poll jitter", () => {
    // Displays poll every 5s; a couple of missed cycles must stay silent.
    expect(displayStaleLevel({ lastRefresh: agoMs(0), now: NOW })).toBe("fresh");
    expect(displayStaleLevel({ lastRefresh: agoMs(5_000), now: NOW })).toBe("fresh");
    expect(displayStaleLevel({ lastRefresh: agoMs(29_000), now: NOW })).toBe("fresh");
  });

  it("warns once past the warn threshold", () => {
    expect(displayStaleLevel({ lastRefresh: agoMs(DISPLAY_STALE_WARN_MS + 1), now: NOW })).toBe("warn");
    expect(displayStaleLevel({ lastRefresh: agoMs(90_000), now: NOW })).toBe("warn");
  });

  it("escalates to alert past the alert threshold", () => {
    expect(displayStaleLevel({ lastRefresh: agoMs(DISPLAY_STALE_ALERT_MS + 1), now: NOW })).toBe("alert");
    // The scenario this whole module exists for: a backend that died hours ago.
    expect(displayStaleLevel({ lastRefresh: agoMs(2 * 60 * 60 * 1000), now: NOW })).toBe("alert");
  });

  it("is exclusive at both boundaries", () => {
    expect(displayStaleLevel({ lastRefresh: agoMs(DISPLAY_STALE_WARN_MS), now: NOW })).toBe("fresh");
    expect(displayStaleLevel({ lastRefresh: agoMs(DISPLAY_STALE_ALERT_MS), now: NOW })).toBe("warn");
  });

  it("treats a future timestamp as fresh rather than reporting a negative age", () => {
    // Clock skew between the browser and the server must not paint a healthy display red.
    expect(displayStaleLevel({ lastRefresh: agoMs(-60_000), now: NOW })).toBe("fresh");
  });

  it("honours custom thresholds", () => {
    expect(
      displayStaleLevel({ lastRefresh: agoMs(2_000), now: NOW, warnMs: 1_000, alertMs: 5_000 }),
    ).toBe("warn");
  });
});

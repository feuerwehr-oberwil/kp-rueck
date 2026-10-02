import { describe, expect, it } from "vitest";
import {
  STALE_BANNER_THRESHOLD_MS,
  isLiveConfirmed,
  shouldShowStaleBanner,
} from "./stale-data";

const now = new Date("2026-05-28T10:00:00Z");

describe("shouldShowStaleBanner", () => {
  it("stays hidden while the WebSocket is connected, regardless of sync age", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "connected",
      lastSyncAt: new Date(now.getTime() - 5 * 60_000),
      now,
    });
    expect(result).toBe(false);
  });

  it("does NOT stay hidden merely because the WebSocket is connecting", () => {
    // Review idea #4: a socket still dialling after the threshold delivers
    // nothing — the board on screen is as old as its last confirmed load.
    const result = shouldShowStaleBanner({
      wsStatus: "connecting",
      lastSyncAt: new Date(now.getTime() - 5 * 60_000),
      now,
    });
    expect(result).toBe(true);
  });

  it("gives a connecting socket the threshold, like any other gap", () => {
    expect(
      shouldShowStaleBanner({ wsStatus: "connecting", lastSyncAt: new Date(now.getTime() - 5_000), now }),
    ).toBe(false);
  });

  describe("connected socket and confirmed data (review idea #4)", () => {
    const liveSince = new Date(now.getTime() - 60_000);

    it("stays hidden once a load got through after the socket came up, however old", () => {
      expect(
        shouldShowStaleBanner({
          wsStatus: "connected",
          liveSince: new Date(now.getTime() - 60 * 60_000),
          lastSyncAt: new Date(now.getTime() - 59 * 60_000),
          now,
        }),
      ).toBe(false);
    });

    it("the connection comes back but the reload has not got through: stays visible", () => {
      expect(
        shouldShowStaleBanner({
          wsStatus: "connected",
          liveSince,
          lastSyncAt: new Date(liveSince.getTime() - 1),
          now,
        }),
      ).toBe(true);
    });

    it("the connection comes back and the reload FAILS: the last confirmed state stays stale", () => {
      expect(
        shouldShowStaleBanner({
          wsStatus: "connected",
          liveSince,
          lastSyncAt: new Date(liveSince.getTime() - 30_000),
          now,
          loadFailed: true,
        }),
      ).toBe(true);
    });

    it("clears with the first confirmed load since the reconnect", () => {
      expect(
        shouldShowStaleBanner({
          wsStatus: "connected",
          liveSince,
          lastSyncAt: new Date(liveSince.getTime() + 500),
          now,
        }),
      ).toBe(false);
    });

    it("a fresh poll confirms the board without any socket at all", () => {
      expect(
        shouldShowStaleBanner({ wsStatus: "error", liveSince: null, lastSyncAt: new Date(now.getTime() - 2_000), now }),
      ).toBe(false);
    });

    it("a just-reconnected socket does not flash it while the resync is under way", () => {
      expect(
        shouldShowStaleBanner({
          wsStatus: "connected",
          liveSince: new Date(now.getTime() - 1_000),
          lastSyncAt: new Date(now.getTime() - 4_000),
          now,
        }),
      ).toBe(false);
    });
  });

  describe("isLiveConfirmed", () => {
    it("needs the socket up and a load at or after it came up", () => {
      const liveSince = new Date(now.getTime() - 10_000);
      expect(isLiveConfirmed({ wsStatus: "connected", liveSince, lastSyncAt: liveSince })).toBe(true);
      expect(isLiveConfirmed({ wsStatus: "connected", liveSince, lastSyncAt: new Date(liveSince.getTime() - 1) })).toBe(false);
      expect(isLiveConfirmed({ wsStatus: "connecting", liveSince, lastSyncAt: now })).toBe(false);
      expect(isLiveConfirmed({ wsStatus: "connected", liveSince: null, lastSyncAt: now })).toBe(false);
    });

    it("takes «connected» at its word for callers that do not know liveSince", () => {
      expect(isLiveConfirmed({ wsStatus: "connected", lastSyncAt: now })).toBe(true);
    });
  });

  it("stays hidden when there has never been a successful sync", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "disconnected",
      lastSyncAt: null,
      now,
    });
    expect(result).toBe(false);
  });

  it("stays hidden while the gap is within the threshold", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "disconnected",
      lastSyncAt: new Date(now.getTime() - 5_000),
      now,
    });
    expect(result).toBe(false);
  });

  it("shows when WS is disconnected and the gap exceeds the threshold", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "disconnected",
      lastSyncAt: new Date(now.getTime() - (STALE_BANNER_THRESHOLD_MS + 1)),
      now,
    });
    expect(result).toBe(true);
  });

  it("shows when WS is in error state and the gap exceeds the threshold", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "error",
      lastSyncAt: new Date(now.getTime() - 60_000),
      now,
    });
    expect(result).toBe(true);
  });

  it("respects an overridden threshold", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "disconnected",
      lastSyncAt: new Date(now.getTime() - 4_000),
      now,
      thresholdMs: 3_000,
    });
    expect(result).toBe(true);
  });

  it("shows on a REST outage even while the WebSocket claims connected", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "connected",
      lastSyncAt: new Date(now.getTime() - 2_000),
      now,
      restReachable: false,
    });
    expect(result).toBe(true);
  });

  it("REST outage still stays hidden when there has never been a sync", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "connected",
      lastSyncAt: null,
      now,
      restReachable: false,
    });
    expect(result).toBe(false);
  });

  it("restReachable=true changes nothing about the WS-based rules", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "connected",
      lastSyncAt: new Date(now.getTime() - 5 * 60_000),
      now,
      restReachable: true,
    });
    expect(result).toBe(false);
  });

  describe("after a failed board load", () => {
    it("shows once the last good sync is past the threshold, even with the socket connected", () => {
      expect(
        shouldShowStaleBanner({
          wsStatus: "connected",
          lastSyncAt: new Date(now.getTime() - STALE_BANNER_THRESHOLD_MS - 1),
          now,
          loadFailed: true,
        }),
      ).toBe(true);
    });

    it("gives a single failed reload the threshold before it raises the banner", () => {
      expect(
        shouldShowStaleBanner({
          wsStatus: "connected",
          lastSyncAt: new Date(now.getTime() - 3_000),
          now,
          loadFailed: true,
        }),
      ).toBe(false);
    });

    it("shows when the FIRST load failed — no good state is not an empty Ereignis", () => {
      expect(
        shouldShowStaleBanner({ wsStatus: "connected", lastSyncAt: null, now, loadFailed: true }),
      ).toBe(true);
    });

    it("stays out of the way of a first load that is merely still running", () => {
      expect(
        shouldShowStaleBanner({ wsStatus: "connected", lastSyncAt: null, now, loadFailed: false }),
      ).toBe(false);
    });
  });
});

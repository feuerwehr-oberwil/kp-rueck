import { describe, expect, it } from "vitest";
import {
  STALE_BANNER_THRESHOLD_MS,
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

  it("stays hidden while the WebSocket is connecting (we are recovering)", () => {
    const result = shouldShowStaleBanner({
      wsStatus: "connecting",
      lastSyncAt: new Date(now.getTime() - 5 * 60_000),
      now,
    });
    expect(result).toBe(false);
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
});

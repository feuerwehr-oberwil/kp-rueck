import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useCurrentTime } from "./use-current-time";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-29T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCurrentTime", () => {
  it("starts null + unmounted, then ticks to the current time", () => {
    const { result } = renderHook(() => useCurrentTime());
    // Effects haven't flushed yet in the initial render snapshot — but
    // because @testing-library flushes useEffects synchronously, the
    // first effect already ran by the time we read result.current.
    expect(result.current.isMounted).toBe(true);
    expect(result.current.currentTime?.toISOString()).toBe(
      "2026-05-29T08:00:00.000Z",
    );
  });

  it("advances on each interval tick", () => {
    const { result } = renderHook(() => useCurrentTime(1000));
    expect(result.current.currentTime?.toISOString()).toBe(
      "2026-05-29T08:00:00.000Z",
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.currentTime?.toISOString()).toBe(
      "2026-05-29T08:00:01.000Z",
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.currentTime?.toISOString()).toBe(
      "2026-05-29T08:00:03.000Z",
    );
  });

  it("clears its interval on unmount", () => {
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useCurrentTime());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("respects a custom interval", () => {
    const { result } = renderHook(() => useCurrentTime(500));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.currentTime?.toISOString()).toBe(
      "2026-05-29T08:00:00.500Z",
    );
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useGPrefixNavigation } from "./use-g-prefix-navigation";

const makeEvent = (key: string): KeyboardEvent => {
  const evt = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  return evt;
};

type PushFn = (href: string) => void;
let push: PushFn & ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  push = vi.fn() as PushFn & ReturnType<typeof vi.fn>;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGPrefixNavigation", () => {
  it("starts inactive", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    expect(result.current.isActive).toBe(false);
  });

  it("'g' arms the prefix and consumes the event", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    const evt = makeEvent("g");

    let consumed = false;
    act(() => {
      consumed = result.current.handleKey(evt);
    });

    expect(consumed).toBe(true);
    expect(result.current.isActive).toBe(true);
    expect(evt.defaultPrevented).toBe(true);
  });

  it("'G M' navigates to /map and clears the prefix", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    act(() => {
      result.current.handleKey(makeEvent("g"));
    });
    expect(result.current.isActive).toBe(true);

    act(() => {
      result.current.handleKey(makeEvent("m"));
    });

    expect(push).toHaveBeenCalledWith("/map");
    expect(result.current.isActive).toBe(false);
  });

  it("'G B' clears the prefix without navigating (already on the Board)", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    act(() => {
      result.current.handleKey(makeEvent("g"));
    });
    act(() => {
      result.current.handleKey(makeEvent("b"));
    });
    expect(push).not.toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
  });

  it("an unknown second key still clears the prefix", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    act(() => {
      result.current.handleKey(makeEvent("g"));
    });
    act(() => {
      result.current.handleKey(makeEvent("x"));
    });
    expect(push).not.toHaveBeenCalled();
    expect(result.current.isActive).toBe(false);
  });

  it("auto-clears the prefix after 1.5s with no second key", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    act(() => {
      result.current.handleKey(makeEvent("g"));
    });
    expect(result.current.isActive).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.isActive).toBe(false);
  });

  it("cancel() clears an armed prefix and reports it", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    act(() => {
      result.current.handleKey(makeEvent("g"));
    });

    let cleared = false;
    act(() => {
      cleared = result.current.cancel();
    });

    expect(cleared).toBe(true);
    expect(result.current.isActive).toBe(false);
  });

  it("cancel() returns false when no prefix is armed", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    let cleared = false;
    act(() => {
      cleared = result.current.cancel();
    });
    expect(cleared).toBe(false);
  });

  it("handleKey returns false for unrelated keys when idle", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    let consumed = false;
    act(() => {
      consumed = result.current.handleKey(makeEvent("a"));
    });
    expect(consumed).toBe(false);
  });

  it("a second 'g' while armed completes the prefix as 'G G' (no nav)", () => {
    const { result } = renderHook(() => useGPrefixNavigation({ push }));
    act(() => {
      result.current.handleKey(makeEvent("g"));
    });
    act(() => {
      result.current.handleKey(makeEvent("g"));
    });
    expect(result.current.isActive).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});

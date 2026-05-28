import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useUnsavedChangesWarning } from "./use-unsaved-changes-warning";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUnsavedChangesWarning", () => {
  it("calls onClose immediately when not dirty", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useUnsavedChangesWarning({ isDirty: false, isOpen: true, onClose }),
    );

    act(() => {
      result.current.requestClose();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.dialogProps.open).toBe(false);
  });

  it("opens the confirm dialog instead of closing when dirty", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useUnsavedChangesWarning({ isDirty: true, isOpen: true, onClose }),
    );

    act(() => {
      result.current.requestClose();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.dialogProps.open).toBe(true);
  });

  it("closes after the user confirms discard", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useUnsavedChangesWarning({ isDirty: true, isOpen: true, onClose }),
    );

    act(() => {
      result.current.requestClose();
    });
    expect(result.current.dialogProps.open).toBe(true);

    act(() => {
      result.current.dialogProps.onConfirm();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.dialogProps.open).toBe(false);
  });

  it("ignores Dialog open=true callbacks (parent controls opening)", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useUnsavedChangesWarning({ isDirty: true, isOpen: true, onClose }),
    );

    act(() => {
      result.current.handleOpenChange(true);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(result.current.dialogProps.open).toBe(false);
  });

  it("registers beforeunload only while dirty + open", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { rerender, unmount } = renderHook(
      ({ dirty, open }: { dirty: boolean; open: boolean }) =>
        useUnsavedChangesWarning({
          isDirty: dirty,
          isOpen: open,
          onClose: () => {},
        }),
      { initialProps: { dirty: false, open: false } },
    );

    expect(
      addSpy.mock.calls.some(([event]) => event === "beforeunload"),
    ).toBe(false);

    rerender({ dirty: true, open: true });
    expect(
      addSpy.mock.calls.filter(([event]) => event === "beforeunload"),
    ).toHaveLength(1);

    rerender({ dirty: false, open: true });
    expect(
      removeSpy.mock.calls.filter(([event]) => event === "beforeunload"),
    ).toHaveLength(1);

    unmount();
  });
});

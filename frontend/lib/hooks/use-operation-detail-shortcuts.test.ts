import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import type { Operation } from "@/lib/contexts/operations-context";

import { useOperationDetailShortcuts } from "./use-operation-detail-shortcuts";

const minimalOperation = (overrides: Partial<Operation> = {}): Operation =>
  ({
    id: "op-1",
    location: "Bahnhof",
    vehicle: null,
    vehicles: [],
    incidentType: "elementarereignis",
    dispatchTime: new Date(),
    crew: [],
    priority: "low",
    status: "incoming",
    coordinates: [47.5, 7.5],
    materials: [],
    notes: "",
    contact: "",
    internalNotes: "",
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    amWarten: false,
    amWartenNote: "",
    zuFuss: false,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  }) as Operation;

const dispatch = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
};

afterEach(() => {
  cleanup();
});

type UpdateFn = (updates: Partial<Operation>) => void;
type AssignFn = (id: string, name: string, opId: string) => void;
type RemoveFn = (opId: string, name: string) => void;

describe("useOperationDetailShortcuts", () => {
  let onUpdate: UpdateFn & ReturnType<typeof vi.fn>;
  let onAssignVehicle: AssignFn & ReturnType<typeof vi.fn>;
  let onRemoveVehicle: RemoveFn & ReturnType<typeof vi.fn>;

  const availableVehicles = [
    { id: "v1", name: "TLF", type: "TLF" },
    { id: "v2", name: "Pio", type: "Pio" },
  ];

  beforeEach(() => {
    onUpdate = vi.fn() as UpdateFn & ReturnType<typeof vi.fn>;
    onAssignVehicle = vi.fn() as AssignFn & ReturnType<typeof vi.fn>;
    onRemoveVehicle = vi.fn() as RemoveFn & ReturnType<typeof vi.fn>;
  });

  it("attaches no listener when disabled", () => {
    renderHook(() =>
      useOperationDetailShortcuts({
        enabled: false,
        operation: minimalOperation(),
        availableVehicles,
        onUpdate,
        onAssignVehicle,
        onRemoveVehicle,
      }),
    );
    dispatch("1");
    expect(onAssignVehicle).not.toHaveBeenCalled();
  });

  it("sets priority on Shift+1/2/3", () => {
    renderHook(() =>
      useOperationDetailShortcuts({
        enabled: true,
        operation: minimalOperation(),
        availableVehicles,
        onUpdate,
        onAssignVehicle,
        onRemoveVehicle,
      }),
    );
    dispatch("1", { shiftKey: true });
    dispatch("2", { shiftKey: true });
    dispatch("3", { shiftKey: true });
    expect(onUpdate.mock.calls.map((c) => c[0])).toEqual([
      { priority: "low" },
      { priority: "medium" },
      { priority: "high" },
    ]);
  });

  it("also handles the shifted symbol variants (! @ #)", () => {
    renderHook(() =>
      useOperationDetailShortcuts({
        enabled: true,
        operation: minimalOperation(),
        availableVehicles,
        onUpdate,
        onAssignVehicle,
        onRemoveVehicle,
      }),
    );
    dispatch("!", { shiftKey: true });
    dispatch("@", { shiftKey: true });
    dispatch("#", { shiftKey: true });
    expect(onUpdate.mock.calls.map((c) => c[0])).toEqual([
      { priority: "low" },
      { priority: "medium" },
      { priority: "high" },
    ]);
  });

  it("toggles zuFuss on '0'", () => {
    renderHook(() =>
      useOperationDetailShortcuts({
        enabled: true,
        operation: minimalOperation({ zuFuss: false }),
        availableVehicles,
        onUpdate,
        onAssignVehicle,
        onRemoveVehicle,
      }),
    );
    dispatch("0");
    expect(onUpdate).toHaveBeenCalledWith({ zuFuss: true });
  });

  it("assigns an unassigned vehicle on number key", () => {
    renderHook(() =>
      useOperationDetailShortcuts({
        enabled: true,
        operation: minimalOperation({ vehicles: [] }),
        availableVehicles,
        onUpdate,
        onAssignVehicle,
        onRemoveVehicle,
      }),
    );
    dispatch("1");
    expect(onAssignVehicle).toHaveBeenCalledWith("v1", "TLF", "op-1");
    expect(onRemoveVehicle).not.toHaveBeenCalled();
  });

  it("removes an already-assigned vehicle on number key", () => {
    renderHook(() =>
      useOperationDetailShortcuts({
        enabled: true,
        operation: minimalOperation({ vehicles: ["Pio"] }),
        availableVehicles,
        onUpdate,
        onAssignVehicle,
        onRemoveVehicle,
      }),
    );
    dispatch("2");
    expect(onRemoveVehicle).toHaveBeenCalledWith("op-1", "Pio");
    expect(onAssignVehicle).not.toHaveBeenCalled();
  });

  it("ignores shortcuts when the event target is an input", () => {
    renderHook(() =>
      useOperationDetailShortcuts({
        enabled: true,
        operation: minimalOperation(),
        availableVehicles,
        onUpdate,
        onAssignVehicle,
        onRemoveVehicle,
      }),
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    document.body.removeChild(input);
    expect(onAssignVehicle).not.toHaveBeenCalled();
  });

  it("detaches the listener when enabled flips to false", () => {
    const initialProps = { enabled: true };
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useOperationDetailShortcuts({
          enabled,
          operation: minimalOperation(),
          availableVehicles,
          onUpdate,
          onAssignVehicle,
          onRemoveVehicle,
        }),
      { initialProps },
    );
    rerender({ enabled: false });
    dispatch("1");
    expect(onAssignVehicle).not.toHaveBeenCalled();
  });
});

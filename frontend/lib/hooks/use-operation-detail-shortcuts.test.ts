import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import type { Operation } from "@/lib/contexts/operations-context";

import {
  readRememberedTab,
  rememberDetailTab,
  resolveArrowTabStep,
  resolveShortcutTab,
  useOperationDetailShortcuts,
} from "./use-operation-detail-shortcuts";

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

describe("resolveShortcutTab", () => {
  it("sends every mutating shortcut to Übersicht, which is where all three controls now live", () => {
    const at = (key: string, shiftKey = false) =>
      resolveShortcutTab({ key, shiftKey, target: document.body }, 2);

    expect(at("3", true)).toBe("overview"); // priority
    expect(at("0")).toBe("overview"); // zu Fuss
    expect(at("2")).toBe("overview"); // second quick-assign vehicle
    // Nothing of ours: a vehicle slot the station has no vehicle for.
    expect(at("5")).toBeNull();
  });
});

describe("resolveArrowTabStep", () => {
  const withTarget = (
    key: string,
    target: EventTarget | null,
    init: Partial<KeyboardEvent> = {},
  ) => resolveArrowTabStep({ key, target, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...init });

  const textInput = (value: string, caret: number) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.setSelectionRange(caret, caret);
    return input;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("walks left and right, and ignores anything else", () => {
    expect(withTarget("ArrowRight", document.body)).toBe(1);
    expect(withTarget("ArrowLeft", document.body)).toBe(-1);
    expect(withTarget("ArrowDown", document.body)).toBe(0);
    expect(withTarget("a", document.body)).toBe(0);
  });

  it("keeps its hands off a modified arrow — those are the browser's and the OS's", () => {
    expect(withTarget("ArrowRight", document.body, { metaKey: true })).toBe(0);
    expect(withTarget("ArrowLeft", document.body, { altKey: true })).toBe(0);
    expect(withTarget("ArrowLeft", document.body, { shiftKey: true })).toBe(0);
  });

  it("yields to the caret only while the caret has somewhere to go", () => {
    // Text on the left of the caret: ← is real cursor movement.
    expect(withTarget("ArrowLeft", textInput("Keller", 6))).toBe(0);
    // Nothing on the right of it: → would do nothing, so it is free.
    expect(withTarget("ArrowRight", textInput("Keller", 6))).toBe(1);
    expect(withTarget("ArrowLeft", textInput("Keller", 0))).toBe(-1);
    expect(withTarget("ArrowRight", textInput("Keller", 0))).toBe(0);
    // An empty field never owns an arrow.
    expect(withTarget("ArrowLeft", textInput("", 0))).toBe(-1);
    expect(withTarget("ArrowRight", textInput("", 0))).toBe(1);
  });

  it("never takes the key from a selection or from a field where arrows change the value", () => {
    const selected = textInput("Keller", 0);
    selected.setSelectionRange(0, 6);
    expect(withTarget("ArrowRight", selected)).toBe(0);

    for (const type of ["time", "number", "date", "range", "checkbox"]) {
      const input = document.createElement("input");
      input.type = type;
      expect(withTarget("ArrowRight", input)).toBe(0);
    }

    const textarea = document.createElement("textarea");
    textarea.value = "Keller ausgepumpt";
    textarea.setSelectionRange(3, 3);
    expect(withTarget("ArrowRight", textarea)).toBe(0);
  });

  it("leaves the widgets that drive themselves with arrows alone", () => {
    for (const role of ["combobox", "listbox", "slider", "radio", "tab"]) {
      const node = document.createElement("div");
      node.setAttribute("role", role);
      expect(withTarget("ArrowRight", node)).toBe(0);
    }

    // Radix's roving focus already walks the trigger list; a second handler
    // would skip a tab. That holds for anything inside a trigger, too.
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    const trigger = document.createElement("button");
    trigger.setAttribute("role", "tab");
    const label = document.createElement("span");
    trigger.appendChild(label);
    list.appendChild(trigger);
    document.body.appendChild(list);
    expect(withTarget("ArrowRight", label)).toBe(0);
  });
});

describe("the remembered detail tab", () => {
  const KEY = "kp-rueck:incident-detail-tabs";
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    // jsdom under Node 26 ships no localStorage at all.
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear(),
    });
  });

  it("keeps one answer per incident", () => {
    expect(readRememberedTab("a")).toBeNull();
    rememberDetailTab("a", "rapport");
    rememberDetailTab("b", "history");
    rememberDetailTab("a", "history");
    expect(readRememberedTab("a")).toBe("history");
    expect(readRememberedTab("b")).toBe("history");
    // One entry per incident, not one per visit.
    expect(JSON.parse(storage.get(KEY)!)).toHaveLength(2);
  });

  it("stays bounded — a storm night is forty Schadenplätze and localStorage never expires", () => {
    for (let i = 0; i < 60; i += 1) rememberDetailTab(`incident-${i}`, "rapport");

    const stored = JSON.parse(storage.get(KEY)!) as [string, string][];
    expect(stored).toHaveLength(40);
    // Most recent first, so the oldest is what falls off the end.
    expect(stored[0][0]).toBe("incident-59");
    expect(readRememberedTab("incident-0")).toBeNull();
    expect(readRememberedTab("incident-59")).toBe("rapport");
  });

  it("drops a stored value that is no longer a tab instead of returning it", () => {
    storage.set(KEY, JSON.stringify([["a", "resources"]]));
    expect(readRememberedTab("a")).toBeNull();
  });

  it("survives a corrupt or foreign-shaped value", () => {
    storage.set(KEY, "{not json");
    expect(readRememberedTab("a")).toBeNull();
    storage.set(KEY, JSON.stringify({ a: "rapport" }));
    expect(readRememberedTab("a")).toBeNull();
  });
});

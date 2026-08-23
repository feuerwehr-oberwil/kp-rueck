import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

import type { Operation } from "@/lib/contexts/operations-context";

const toastLoading = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    loading: (...args: unknown[]) => {
      toastLoading(...args);
      return "toast-id";
    },
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const openCommandPalette = vi.fn();
vi.mock("@/components/ui/command-palette", () => ({
  openCommandPalette: () => openCommandPalette(),
}));

import {
  useKanbanShortcuts,
  type KanbanShortcutsActions,
  type KanbanShortcutsState,
} from "./use-kanban-shortcuts";
import type { UseGPrefixNavigation } from "./use-g-prefix-navigation";

const baseOp = (overrides: Partial<Operation> = {}): Operation =>
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

const press = (key: string, init: KeyboardEventInit = {}) => {
  const evt = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(evt);
  return evt;
};

const makeGPrefix = (
  overrides: Partial<UseGPrefixNavigation> = {},
): UseGPrefixNavigation => ({
  isActive: false,
  handleKey: vi.fn(() => false),
  cancel: vi.fn(() => false),
  ...overrides,
});

let actions: KanbanShortcutsActions;

beforeEach(() => {
  toastLoading.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  openCommandPalette.mockReset();
  actions = {
    onToggleVehicle: vi.fn(),
    onUpdateOperation: vi.fn(),
    onMoveRight: vi.fn(),
    onMoveLeft: vi.fn(),
    onToggleZuFuss: vi.fn(),
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onOpenDetail: vi.fn(),
    onRequestDelete: vi.fn(),
    onOpenNewEmergency: vi.fn(),
    onFocusSearch: vi.fn(),
    onFocusPersonnel: vi.fn(),
    onFocusMaterial: vi.fn(),
    onToggleVehicleFooter: vi.fn(),
    onToggleAuftraege: vi.fn(),
    onToggleLeftSidebar: vi.fn(),
    onToggleRightSidebar: vi.fn(),
    onToggleSidePanel: vi.fn(),
    onSidePanelDetail: vi.fn(),
    onTogglePrint: vi.fn(),
    onSidePanelMap: vi.fn(),
    onToggleNotifications: vi.fn(),
  } as unknown as KanbanShortcutsActions;
});

afterEach(() => cleanup());

const baseState = (
  overrides: Partial<KanbanShortcutsState> = {},
): KanbanShortcutsState => ({
  modalOpen: false,
  hoveredOperationId: null,
  selectedOperationId: null,
  operations: [],
  vehicleTypes: [],
  gPrefix: makeGPrefix(),
  ...overrides,
});

describe("useKanbanShortcuts", () => {
  describe("guards", () => {
    it("skips all shortcuts when modalOpen=true", () => {
      renderHook(() => useKanbanShortcuts(baseState({ modalOpen: true }), actions));
      press("n");
      expect(actions.onOpenNewEmergency).not.toHaveBeenCalled();
    });

    it("skips shortcuts when typing in an input (except Esc/blur)", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
      expect(actions.onOpenNewEmergency).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });

    it("Esc on an input blurs it when no g-prefix is armed", () => {
      const gPrefix = makeGPrefix({ cancel: vi.fn(() => false) });
      renderHook(() => useKanbanShortcuts(baseState({ gPrefix }), actions));
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(document.activeElement).not.toBe(input);
      document.body.removeChild(input);
    });

    it("stands down while a dropdown menu is open", () => {
      // Menus are unmanaged Radix state, so `modalOpen` cannot see them — but
      // an open one owns the keyboard (typeahead, arrows, Enter).
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.setAttribute("data-state", "open");
      document.body.appendChild(menu);

      press("n");
      expect(actions.onOpenNewEmergency).not.toHaveBeenCalled();

      menu.remove();
      press("n");
      expect(actions.onOpenNewEmergency).toHaveBeenCalledTimes(1);
    });

    it("forwards keys to gPrefix.handleKey and short-circuits when consumed", () => {
      const handleKey = vi.fn(() => true);
      const gPrefix = makeGPrefix({ handleKey });
      renderHook(() => useKanbanShortcuts(baseState({ gPrefix }), actions));
      press("g");
      expect(handleKey).toHaveBeenCalled();
      expect(actions.onOpenNewEmergency).not.toHaveBeenCalled();
    });
  });

  describe("operation-targeted shortcuts", () => {
    // Two targets on purpose: a key that SHOWS something follows the pointer,
    // a key that CHANGES something follows the click. See the hook's own note.
    it("'0' toggles zu_fuss on the selected op", () => {
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ selectedOperationId: "op-1", operations: [baseOp()] }),
          actions,
        ),
      );
      press("0");
      expect(actions.onToggleZuFuss).toHaveBeenCalledWith("op-1");
    });

    it("mutating keys do nothing on a merely hovered card", () => {
      const vehicleTypes = [{ key: "1", id: "v1", name: "TLF" }];
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ hoveredOperationId: "op-1", operations: [baseOp()], vehicleTypes }),
          actions,
        ),
      );
      press("0");
      press("1");
      press("1", { shiftKey: true });
      press(">");
      press("<");
      press("Delete");
      expect(actions.onToggleZuFuss).not.toHaveBeenCalled();
      expect(actions.onToggleVehicle).not.toHaveBeenCalled();
      expect(actions.onUpdateOperation).not.toHaveBeenCalled();
      expect(actions.onMoveRight).not.toHaveBeenCalled();
      expect(actions.onMoveLeft).not.toHaveBeenCalled();
      expect(actions.onRequestDelete).not.toHaveBeenCalled();
    });

    it("vehicle number key toggles assignment via onToggleVehicle", () => {
      const vehicleTypes = [{ key: "1", id: "v1", name: "TLF" }];
      renderHook(() =>
        useKanbanShortcuts(
          baseState({
            selectedOperationId: "op-1",
            operations: [baseOp({ vehicles: [] })],
            vehicleTypes,
          }),
          actions,
        ),
      );
      press("1");
      expect(actions.onToggleVehicle).toHaveBeenCalledWith(
        vehicleTypes[0],
        "op-1",
        false,
      );
    });

    it("vehicle number key reports already-assigned=true when vehicle is in the op", () => {
      const vehicleTypes = [{ key: "2", id: "v2", name: "Pio" }];
      renderHook(() =>
        useKanbanShortcuts(
          baseState({
            selectedOperationId: "op-1",
            operations: [baseOp({ vehicles: ["Pio"] })],
            vehicleTypes,
          }),
          actions,
        ),
      );
      press("2");
      expect(actions.onToggleVehicle).toHaveBeenCalledWith(
        vehicleTypes[0],
        "op-1",
        true,
      );
    });

    it("Shift+1/2/3 sets priority", () => {
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ selectedOperationId: "op-1", operations: [baseOp()] }),
          actions,
        ),
      );
      press("1", { shiftKey: true });
      press("2", { shiftKey: true });
      press("3", { shiftKey: true });
      expect(actions.onUpdateOperation).toHaveBeenNthCalledWith(1, "op-1", {
        priority: "low",
      });
      expect(actions.onUpdateOperation).toHaveBeenNthCalledWith(2, "op-1", {
        priority: "medium",
      });
      expect(actions.onUpdateOperation).toHaveBeenNthCalledWith(3, "op-1", {
        priority: "high",
      });
    });

    it("Shift+1/2/3 sets priority on Swiss/German layout (shifted char differs, e.code matches)", () => {
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ selectedOperationId: "op-1", operations: [baseOp()] }),
          actions,
        ),
      );
      // Swiss German: Shift+1/2/3 print "+ " * — not ! @ #. e.code stays Digit1/2/3.
      press("+", { shiftKey: true, code: "Digit1" });
      press('"', { shiftKey: true, code: "Digit2" });
      press("*", { shiftKey: true, code: "Digit3" });
      expect(actions.onUpdateOperation).toHaveBeenNthCalledWith(1, "op-1", {
        priority: "low",
      });
      expect(actions.onUpdateOperation).toHaveBeenNthCalledWith(2, "op-1", {
        priority: "medium",
      });
      expect(actions.onUpdateOperation).toHaveBeenNthCalledWith(3, "op-1", {
        priority: "high",
      });
    });

    it("'>' and '<' move the selected op forward / back", () => {
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ selectedOperationId: "op-1", operations: [baseOp()] }),
          actions,
        ),
      );
      press(">");
      press("<");
      expect(actions.onMoveRight).toHaveBeenCalledWith("op-1");
      expect(actions.onMoveLeft).toHaveBeenCalledWith("op-1");
    });

    it("'e' opens the detail modal for the hovered op", () => {
      const op = baseOp();
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ hoveredOperationId: op.id, operations: [op] }),
          actions,
        ),
      );
      press("e");
      expect(actions.onOpenDetail).toHaveBeenCalledWith(op);
    });

    it("Enter opens the hovered op only when nothing activatable has focus", () => {
      const op = baseOp();
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ hoveredOperationId: op.id, operations: [op] }),
          actions,
        ),
      );

      // A focused button owns Enter — the board must not take it, or the whole
      // keyboard UI dies while the pointer merely rests over a card.
      const button = document.createElement("button");
      document.body.appendChild(button);
      const fromButton = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(fromButton);
      expect(actions.onOpenDetail).not.toHaveBeenCalled();
      expect(fromButton.defaultPrevented).toBe(false);
      button.remove();

      const bare = press("Enter");
      expect(actions.onOpenDetail).toHaveBeenCalledWith(op);
      expect(bare.defaultPrevented).toBe(true);
    });

    it("'Delete' stages the selected op for delete confirmation", () => {
      const op = baseOp();
      renderHook(() =>
        useKanbanShortcuts(
          baseState({ selectedOperationId: op.id, operations: [op] }),
          actions,
        ),
      );
      press("Delete");
      expect(actions.onRequestDelete).toHaveBeenCalledWith(op);
    });
  });

  describe("standalone shortcuts", () => {
    it("'n' opens the new-emergency modal", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("n");
      expect(actions.onOpenNewEmergency).toHaveBeenCalled();
    });

    it("'/' focuses search", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("/");
      expect(actions.onFocusSearch).toHaveBeenCalled();
    });

    it("'f' toggles the vehicle footer", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("f");
      expect(actions.onToggleVehicleFooter).toHaveBeenCalled();
    });

    it("'a' toggles the Aufträge footer sheet", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("a");
      expect(actions.onToggleAuftraege).toHaveBeenCalledTimes(1);
    });

    it("'[' / 'q' toggle the left sidebar", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("[");
      press("q");
      expect(actions.onToggleLeftSidebar).toHaveBeenCalledTimes(2);
    });

    it("'b' toggles notifications", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("b");
      expect(actions.onToggleNotifications).toHaveBeenCalled();
    });

    it("'?' opens the command palette", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("?");
      expect(openCommandPalette).toHaveBeenCalledTimes(1);
    });

    it("'?' inside an input does not open the command palette", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "?", bubbles: true }),
      );
      expect(openCommandPalette).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });
  });

  describe("modifier-aware keys", () => {
    it("ignores 'n' when Cmd/Ctrl held (lets the browser handle Cmd+N)", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("n", { metaKey: true });
      expect(actions.onOpenNewEmergency).not.toHaveBeenCalled();
    });

    it("ignores 'r' when Cmd held but fires R on bare press", () => {
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("r", { metaKey: true });
      expect(actions.onRefresh).not.toHaveBeenCalled();
      press("r");
      expect(actions.onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("side panel view switching", () => {
    it("'k' opens the Karte with the side panel COLLAPSED", () => {
      // The binding used to require an open side panel — a leftover from when
      // `k` switched the panel into a map mode. It navigates to /map now, which
      // has nothing to do with the panel, so a collapsed panel must not eat it.
      renderHook(() =>
        useKanbanShortcuts(baseState(), actions),
      );
      press("k");
      expect(actions.onSidePanelMap).toHaveBeenCalledTimes(1);
    });

    it("'k' opens the Karte with the side panel OPEN", () => {
      renderHook(() =>
        useKanbanShortcuts(baseState(), actions),
      );
      press("k");
      expect(actions.onSidePanelMap).toHaveBeenCalledTimes(1);
    });

    it("'k' stands down while typing or under an open menu", () => {
      renderHook(() =>
        useKanbanShortcuts(baseState(), actions),
      );

      const input = document.createElement("input");
      document.body.appendChild(input);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
      expect(actions.onSidePanelMap).not.toHaveBeenCalled();
      input.remove();

      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.setAttribute("data-state", "open");
      document.body.appendChild(menu);
      press("k");
      expect(actions.onSidePanelMap).not.toHaveBeenCalled();
      menu.remove();

      press("k");
      expect(actions.onSidePanelMap).toHaveBeenCalledTimes(1);
    });

    it("'k' stands down while a modal is open", () => {
      renderHook(() =>
        useKanbanShortcuts(baseState({ modalOpen: true }), actions),
      );
      press("k");
      expect(actions.onSidePanelMap).not.toHaveBeenCalled();
    });

    it("'d' prints — it no longer switches the panel view", () => {
      // The old binding fired only while the panel was already open, and the
      // panel's only other mode is `collapsed`, so it set `detail` on something
      // that was already `detail`. The key belongs to the Drucken-Sheet now, and
      // since the hook no longer knows about panel state at all, it cannot
      // depend on it: pressing twice must print twice.
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("d");
      press("d");

      expect(actions.onSidePanelDetail).not.toHaveBeenCalled();
      expect(actions.onTogglePrint).toHaveBeenCalledTimes(2);
    });
  });

  describe("refresh flow", () => {
    it("'r' calls onRefresh and resolves to success toast", async () => {
      let resolveRefresh: (v?: unknown) => void = () => {};
      (actions.onRefresh as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((res) => {
          resolveRefresh = res;
        }),
      );
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("r");
      expect(toastLoading).toHaveBeenCalledWith("Aktualisiere...");
      expect(actions.onRefresh).toHaveBeenCalled();
      await new Promise<void>((res) => {
        resolveRefresh();
        setTimeout(res, 0);
      });
      expect(toastSuccess).toHaveBeenCalled();
    });

    it("toasts an error when refresh rejects", async () => {
      let rejectRefresh: (e?: unknown) => void = () => {};
      (actions.onRefresh as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((_res, rej) => {
          rejectRefresh = rej;
        }),
      );
      renderHook(() => useKanbanShortcuts(baseState(), actions));
      press("r");
      await new Promise<void>((res) => {
        rejectRefresh(new Error("nope"));
        setTimeout(res, 0);
      });
      expect(toastError).toHaveBeenCalled();
    });
  });
});

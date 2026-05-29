import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { Material, Operation } from "@/lib/contexts/operations-context";

const getIncidentRekoReports = vi.fn();
const copyToClipboardAsync = vi.fn();
const formatWhatsAppMessage = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getIncidentRekoReports: (...args: unknown[]) =>
      getIncidentRekoReports(...args),
  },
}));

vi.mock("@/lib/utils", () => ({
  copyToClipboardAsync: (...args: unknown[]) => copyToClipboardAsync(...args),
  copyToClipboard: vi.fn(),
  cn: (...inputs: unknown[]) => inputs.join(" "),
}));

vi.mock("@/lib/whatsapp-formatter", () => ({
  formatWhatsAppMessage: (...args: unknown[]) => formatWhatsAppMessage(...args),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { useWhatsAppCopy } from "./use-whatsapp-copy";

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

const materials: Material[] = [];
const vehicleDrivers = new Map<string, string>();

beforeEach(() => {
  getIncidentRekoReports.mockReset();
  copyToClipboardAsync.mockReset().mockResolvedValue(undefined);
  formatWhatsAppMessage.mockReset().mockReturnValue("formatted msg");
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("useWhatsAppCopy", () => {
  it("no-ops when operation is null", () => {
    const { result } = renderHook(() =>
      useWhatsAppCopy({ operation: null, materials, vehicleDrivers }),
    );
    act(() => result.current.copy());
    expect(copyToClipboardAsync).not.toHaveBeenCalled();
  });

  it("formats and copies without fetching reko when no completed reko exists", async () => {
    const op = baseOp({ hasCompletedReko: false });
    const { result } = renderHook(() =>
      useWhatsAppCopy({ operation: op, materials, vehicleDrivers }),
    );

    await act(async () => {
      result.current.copy();
    });

    expect(getIncidentRekoReports).not.toHaveBeenCalled();
    expect(formatWhatsAppMessage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: op, rekoReport: null }),
    );
    expect(copyToClipboardAsync).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("fetches + uses the latest non-draft reko report when one exists", async () => {
    getIncidentRekoReports.mockResolvedValue([
      { id: "r1", is_draft: true },
      { id: "r2", is_draft: false },
      { id: "r3", is_draft: false },
    ]);
    const op = baseOp({ hasCompletedReko: true });
    const { result } = renderHook(() =>
      useWhatsAppCopy({ operation: op, materials, vehicleDrivers }),
    );

    await act(async () => {
      result.current.copy();
    });

    await waitFor(() => expect(formatWhatsAppMessage).toHaveBeenCalled());
    const arg = formatWhatsAppMessage.mock.calls[0]?.[0] as {
      rekoReport: { id: string } | null;
    };
    expect(arg.rekoReport?.id).toBe("r3");
  });

  it("surfaces a toast error on clipboard failure", async () => {
    copyToClipboardAsync.mockRejectedValue(new Error("denied"));
    const op = baseOp();
    const { result } = renderHook(() =>
      useWhatsAppCopy({ operation: op, materials, vehicleDrivers }),
    );

    await act(async () => {
      result.current.copy();
    });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]?.[0]).toBe("Fehler beim Kopieren");
  });
});

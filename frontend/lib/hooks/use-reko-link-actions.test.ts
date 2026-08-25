import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const generateRekoLink = vi.fn();
const generateFeldLink = vi.fn();
const copyToClipboardMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    generateRekoLink: (...args: unknown[]) => generateRekoLink(...args),
    generateFeldLink: (...args: unknown[]) => generateFeldLink(...args),
  },
}));

vi.mock("@/lib/utils", () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboardMock(...args),
  cn: (...inputs: unknown[]) => inputs.join(" "),
  copyToClipboardAsync: vi.fn(),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { useRekoLinkActions } from "./use-reko-link-actions";

beforeEach(() => {
  generateRekoLink.mockReset();
  generateFeldLink.mockReset();
  copyToClipboardMock.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("useRekoLinkActions", () => {
  const incidentId = "abc";
  const assignedReko = { id: "p1", name: "Müller" };
  const eventId = "evt";

  it("toasts an error and skips the API when copyDirectLink is called without an assigned reko", async () => {
    const { result } = renderHook(() =>
      useRekoLinkActions({ incidentId, assignedReko: null, eventId }),
    );

    await act(async () => {
      await result.current.copyDirectLink();
    });

    expect(toastError).toHaveBeenCalledWith("Keine Reko-Person zugewiesen");
    expect(generateRekoLink).not.toHaveBeenCalled();
  });

  it("copies the generated direct link and flashes copied=direct", async () => {
    generateRekoLink.mockResolvedValue({ link: "/reko/form/abc?t=xyz" });
    const { result } = renderHook(() =>
      useRekoLinkActions({ incidentId, assignedReko, eventId }),
    );

    await act(async () => {
      await result.current.copyDirectLink();
    });

    expect(generateRekoLink).toHaveBeenCalledWith(incidentId, assignedReko.id);
    expect(copyToClipboardMock).toHaveBeenCalledWith(
      expect.stringContaining("/reko/form/abc?t=xyz"),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Direkt-Link kopiert",
      expect.objectContaining({ description: expect.stringContaining("Müller") }),
    );
    expect(result.current.copied).toBe("direct");
  });

  it("toasts an error and skips the API when copyDashboardLink is called without an event", async () => {
    const { result } = renderHook(() =>
      useRekoLinkActions({ incidentId, assignedReko, eventId: null }),
    );

    await act(async () => {
      await result.current.copyDashboardLink();
    });

    expect(toastError).toHaveBeenCalledWith("Kein Ereignis ausgewählt");
    expect(generateFeldLink).not.toHaveBeenCalled();
  });

  it("copies the field link — the Reko trupp's page since plan 26", async () => {
    // The Reko trupp opens `/feld` like everybody else since plan 26.
    generateFeldLink.mockResolvedValue({ link: "/feld?token=xyz" });
    const { result } = renderHook(() =>
      useRekoLinkActions({ incidentId, assignedReko, eventId }),
    );

    await act(async () => {
      await result.current.copyDashboardLink();
    });

    expect(generateFeldLink).toHaveBeenCalledWith(eventId);
    expect(result.current.copied).toBe("dashboard");
  });

  it("surfaces API failure as an error toast and clears the loading state", async () => {
    generateRekoLink.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useRekoLinkActions({ incidentId, assignedReko, eventId }),
    );

    await act(async () => {
      await result.current.copyDirectLink();
    });

    expect(toastError).toHaveBeenCalledWith("Kopieren fehlgeschlagen");
    await waitFor(() => expect(result.current.isCopying).toBe(false));
  });
});

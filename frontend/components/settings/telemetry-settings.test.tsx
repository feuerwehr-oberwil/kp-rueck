import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

// The guarantees worth pinning here are the ones the whole channel rests on:
//   1. What will be sent is READABLE before the decision, verbatim, not described in a sentence.
//   2. What is shown is what is sent — one snapshot feeds both, so they cannot drift.
//   3. A failure is never a dead end: the clipboard route needs no server and is always there.

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { TelemetrySettings } from "@/components/settings/telemetry-settings";

const writeText = vi.fn();

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: (...args: unknown[]) => writeText(...args) },
    configurable: true,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
});

describe("TelemetrySettings — the manual report", () => {
  it("shows the payload verbatim, open, before anything is sent", async () => {
    renderWithIntl(<TelemetrySettings isAdmin={false} />);

    // Open by default: behind a summary the promise is unread at the moment it matters.
    const details = await waitFor(() => {
      const el = document.querySelector("details");
      expect(el).not.toBeNull();
      return el as HTMLDetailsElement;
    });
    expect(details.hasAttribute("open")).toBe(true);

    // …and it is the real environment, not a description of it.
    const block = details.querySelector("pre")?.textContent ?? "";
    await waitFor(() => expect(block.length).toBeGreaterThan(0));
    expect(details.querySelector("pre")?.textContent).toContain(navigator.userAgent);
  });

  it("stops typing at the server cap rather than letting the POST 422", () => {
    renderWithIntl(<TelemetrySettings isAdmin={false} />);
    const box = document.getElementById("telemetry-message") as HTMLTextAreaElement;
    // Without this the report is rejected and the operator is told they are offline.
    expect(box.maxLength).toBe(4000);
  });

  it("offers the clipboard even before anything has failed — it needs no server", async () => {
    const user = userEvent.setup();
    // After setup(), not before: user-event installs a clipboard stub of its own and would
    // otherwise shadow ours.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (...args: unknown[]) => writeText(...args) },
      configurable: true,
    });
    renderWithIntl(<TelemetrySettings isAdmin={false} />);

    await user.type(document.getElementById("telemetry-message") as HTMLTextAreaElement, "Karte leer");
    await user.click(screen.getByRole("button", { name: /kopieren/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain("Karte leer");
    // The technical block travels with it, so a pasted report is as complete as a sent one.
    expect(copied).toContain(navigator.userAgent);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("will not send an empty report", () => {
    renderWithIntl(<TelemetrySettings isAdmin={false} />);
    const send = screen.getByRole("button", { name: /senden/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  it("explains a deployment with outbound switched off instead of calling it an error", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TelemetrySettings isAdmin={false} />);

    await user.type(document.getElementById("telemetry-message") as HTMLTextAreaElement, "geht nicht");
    await user.click(screen.getByRole("button", { name: /senden/i }));

    // 503 is the deployer's configuration, not a fault — and the clipboard is still on screen.
    await waitFor(() => expect(screen.getByText(/abgeschaltet/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: /kopieren/i })).toBeTruthy();
  });
});

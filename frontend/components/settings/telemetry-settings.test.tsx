import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

// The guarantees worth pinning here are the ones the card rests on now that the app is no
// longer the transport:
//   1. What will be handed over is READABLE before the decision, verbatim, not described.
//   2. Nothing is POSTed anywhere — the routes are a GitHub form and a mailto:, and the one
//      the operator picked is the one that opens.
//   3. The Diagnose-Datei is saved in the same click, because a report without it is a
//      sentence.

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { TelemetrySettings } from "@/components/settings/telemetry-settings";
import { feedbackConfig } from "@/lib/feedback-report";

const A_BUNDLE = {
  generatedAt: "2026-09-10T08:00:00Z",
  app: "kp-rueck",
  release: "0.7.0",
  install: "9f1c",
  device: "Chrome auf Windows",
  errors: [{ kind: "render", message: "TypeError" }],
  errorsKept: 50,
  note: "Bereinigte Fehlerprotokolle",
};

/** `/api/diag/export` answers with the bundle; anything else (the admin status calls) 403s,
 *  which is what a non-admin session really gets. */
function stubFetch(bundle: unknown = A_BUNDLE) {
  const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) => {
    if (String(url).includes("/api/diag/export")) {
      return { ok: true, status: 200, json: async () => bundle };
    }
    return { ok: false, status: 403, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const openedUrls: string[] = [];

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  openedUrls.length = 0;
  stubFetch();
  vi.stubGlobal("open", vi.fn((url: string) => { openedUrls.push(url); return null; }));
  // jsdom implements neither, and the save path touches both.
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:diag"),
    revokeObjectURL: vi.fn(),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Fill in the description — «Weiter» stays disabled without one. */
async function describeTheProblem(user: ReturnType<typeof userEvent.setup>, text = "Karte leer") {
  await user.type(document.getElementById("telemetry-message") as HTMLTextAreaElement, text);
}

describe("TelemetrySettings — handing a report over", () => {
  it("shows the technical block verbatim, not a description of it", async () => {
    renderWithIntl(<TelemetrySettings isAdmin={false} />);

    const block = await waitFor(() => {
      const pre = document.querySelector("details pre");
      expect(pre?.textContent).toBeTruthy();
      return pre as HTMLElement;
    });
    // The real environment, not a sentence about it.
    expect(block.textContent).toContain(navigator.userAgent);
    // …and the traces that travel with it are counted in the same block.
    await waitFor(() => expect(block.textContent).toContain("1 Fehlerprotokoll"));
  });

  it("opens the prefilled GitHub form and saves the Diagnose-Datei in the same click", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TelemetrySettings isAdmin={false} />);
    await waitFor(() => expect(document.body.textContent).toContain("1 Fehlerprotokoll"));

    await describeTheProblem(user);
    await user.click(screen.getByRole("button", { name: /weiter/i }));

    expect(openedUrls).toHaveLength(1);
    const url = new URL(openedUrls[0]);
    expect(url.origin + url.pathname).toBe("https://github.com/feuerwehr-oberwil/kp-rueck/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("what")).toBe("Karte leer");
    // The diagnostics field carries the block the operator just read.
    expect(url.searchParams.get("diagnostics")).toContain(navigator.userAgent);
    // The file is named in the confirmation, so «anhängen» points at something findable.
    expect(String(toastSuccess.mock.calls[0][0])).toContain("kp-rueck-diagnose-2026-09-10.json");
  });

  it("sends nothing on its own — no POST leaves the app", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();
    renderWithIntl(<TelemetrySettings isAdmin={false} />);

    await describeTheProblem(user);
    await user.click(screen.getByRole("button", { name: /weiter/i }));

    // The export is a GET the operator's own server answers; nothing else is called, and
    // above all nothing is POSTed to an ingest that no longer exists.
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
    }
  });

  it("uses mailto: when the operator picks the mail route", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TelemetrySettings isAdmin={false} />);

    const hrefs: string[] = [];
    Object.defineProperty(window, "location", {
      value: { set href(v: string) { hrefs.push(v); } },
      configurable: true,
    });

    await describeTheProblem(user, "Board weiss");
    await user.click(screen.getByRole("button", { name: /per e-mail/i }));
    await user.click(screen.getByRole("button", { name: /weiter/i }));

    expect(openedUrls).toHaveLength(0);
    // Read from the config rather than hard-coding it: the address is a deployment concern
    // (a station that triages internally overrides it), so pinning the literal here would
    // make this test fail for a correct change to that setting.
    expect(hrefs[0]).toMatch(
      new RegExp(`^mailto:${feedbackConfig.mailto.replace(/[.+]/g, "\\$&")}\\?`),
    );
    // Encoded, not raw: an unencoded newline or & truncates the body in some clients.
    expect(hrefs[0]).toContain(encodeURIComponent("Board weiss"));
  });

  it("will not hand over an empty report", () => {
    renderWithIntl(<TelemetrySettings isAdmin={false} />);
    const next = screen.getByRole("button", { name: /weiter/i }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("says so plainly when there is nothing to attach", async () => {
    stubFetch({ ...A_BUNDLE, errors: [] });
    renderWithIntl(<TelemetrySettings isAdmin={false} />);

    // Not a promised file with nothing in it — the empty buffer is stated.
    await waitFor(() => expect(document.body.textContent).toContain("keine Fehlerprotokolle aufgezeichnet"));
  });
});

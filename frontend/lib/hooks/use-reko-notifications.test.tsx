import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiRekoSummary } from "@/lib/api/types/reko";

const getEventRekoSummaries = vi.fn();
const getIncidentRekoReports = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getEventRekoSummaries: (...args: unknown[]) => getEventRekoSummaries(...args),
    getIncidentRekoReports: (...args: unknown[]) => getIncidentRekoReports(...args),
  },
}));

const refetchNotifications = vi.fn();
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: { id: "event-1" } }) }));
vi.mock("@/lib/contexts/notification-context", () => ({ useNotifications: () => ({ refetchNotifications }) }));
vi.mock("@/lib/i18n-messages", () => ({ translateOutsideReact: (key: string) => key }));

const wsHandlers = new Map<string, () => void>();
vi.mock("@/lib/websocket-client", () => ({
  wsClient: {
    on: (event: string, handler: () => void) => { wsHandlers.set(event, handler); return () => wsHandlers.delete(event); },
    onStatusChange: () => () => {},
    // Connected: the fallback poll never arms, so no timers in the test.
    getStatus: () => "connected",
  },
}));

import { useRekoNotifications, withRekoSummary } from "./use-reko-notifications";
import type { RekoSummary } from "@/lib/contexts/operations-context";
import { makeOperation } from "@/test-utils/operation-fixtures"

const summary = (incident_id: string, submitted_at: string, extra: Partial<ApiRekoSummary> = {}): ApiRekoSummary => ({
  incident_id, has_completed_reko: true, arrived_at: null, is_relevant: true,
  dangers_json: null, effort_json: null, summary_text: "Keller unter Wasser", photos_json: [],
  submitted_at, submitted_by_personnel_name: null, ...extra,
});
const respond = (...xs: ApiRekoSummary[]) => ({ summaries: Object.fromEntries(xs.map((x) => [x.incident_id, x])), total: xs.length });

beforeEach(() => {
  getEventRekoSummaries.mockReset();
  getIncidentRekoReports.mockReset();
  refetchNotifications.mockReset();
  wsHandlers.clear();
});

describe("useRekoNotifications", () => {
  it("checks with ONE bulk request, never one per card, and not again when the board reloads", async () => {
    getEventRekoSummaries.mockResolvedValue(respond(summary("a", "2026-10-06T08:00:00Z")));
    const onUpdate = vi.fn();
    const { rerender } = renderHook(({ cb }) => useRekoNotifications(undefined, cb), { initialProps: { cb: onUpdate } });
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(1));
    expect(getEventRekoSummaries).toHaveBeenCalledWith("event-1");

    // a board reload hands the page new callbacks; that used to re-run the per-card fetch
    rerender({ cb: vi.fn() });
    rerender({ cb: vi.fn() });
    expect(getEventRekoSummaries).toHaveBeenCalledTimes(1);
    expect(getIncidentRekoReports).not.toHaveBeenCalled();
    // the first load only marks what is there as seen
    expect(onUpdate).not.toHaveBeenCalled();
    expect(refetchNotifications).not.toHaveBeenCalled();
  });

  it("applies a newly submitted report on reko_update, including a newer one on the same card", async () => {
    getEventRekoSummaries.mockResolvedValueOnce(respond(summary("a", "2026-10-06T08:00:00Z")));
    const onUpdate = vi.fn();
    renderHook(() => useRekoNotifications(undefined, onUpdate));
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(1));

    getEventRekoSummaries.mockResolvedValueOnce(respond(
      summary("a", "2026-10-06T09:00:00Z", { dangers_json: { fire: true } as ApiRekoSummary["dangers_json"] }),
      summary("b", "2026-10-06T09:05:00Z"),
    ));
    await act(async () => { wsHandlers.get("reko_update")?.(); });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
    expect(onUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ hasDangers: true, summaryText: "Keller unter Wasser" }));
    expect(onUpdate).toHaveBeenCalledWith("b", expect.objectContaining({ hasDangers: false }));
    expect(refetchNotifications).toHaveBeenCalledTimes(1);

    // the same answer again is nothing new
    getEventRekoSummaries.mockResolvedValueOnce(respond(
      summary("a", "2026-10-06T09:00:00Z", { dangers_json: { fire: true } as ApiRekoSummary["dangers_json"] }),
      summary("b", "2026-10-06T09:05:00Z"),
    ));
    await act(async () => { wsHandlers.get("reko_update")?.(); });
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(3));
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("ignores a Reko that has only arrived, not submitted", async () => {
    getEventRekoSummaries.mockResolvedValueOnce(respond());
    const onUpdate = vi.fn();
    renderHook(() => useRekoNotifications(undefined, onUpdate));
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(1));
    getEventRekoSummaries.mockResolvedValueOnce(respond(summary("a", "", { has_completed_reko: false, submitted_at: null, arrived_at: "2026-10-06T09:00:00Z" })));
    await act(async () => { wsHandlers.get("reko_update")?.(); });
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(2));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("applies an auto-saved amendment of the same filing to the card, without the bell (pass 4, S6)", async () => {
    getEventRekoSummaries.mockResolvedValueOnce(respond(summary("a", "2026-10-06T08:00:00Z")));
    const onUpdate = vi.fn();
    renderHook(() => useRekoNotifications(undefined, onUpdate));
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(1));

    getEventRekoSummaries.mockResolvedValueOnce(respond(summary("a", "2026-10-06T08:00:00Z", { summary_text: "Keller 20 cm" })));
    await act(async () => { wsHandlers.get("reko_update")?.(); });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ summaryText: "Keller 20 cm" })));
    expect(refetchNotifications).not.toHaveBeenCalled();
  });
});

describe("useRekoNotifications – the verdict", () => {
  it("keeps an unanswered «Einsatz relevant?» unanswered on the card (pass 5, S5)", async () => {
    getEventRekoSummaries.mockResolvedValueOnce(respond());
    const onUpdate = vi.fn();
    renderHook(() => useRekoNotifications(undefined, onUpdate));
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(1));

    getEventRekoSummaries.mockResolvedValueOnce(respond(summary("a", "2026-10-06T09:00:00Z", { is_relevant: null })));
    await act(async () => { wsHandlers.get("reko_update")?.(); });

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ isRelevant: null })));
  });
});

describe("useRekoNotifications – overlapping reads", () => {
  it("drops an older read that answers after a newer one (pass 5, S6)", async () => {
    getEventRekoSummaries.mockResolvedValueOnce(respond(summary("a", "2026-10-06T08:00:00Z")));
    const onUpdate = vi.fn();
    renderHook(() => useRekoNotifications(undefined, onUpdate));
    await waitFor(() => expect(getEventRekoSummaries).toHaveBeenCalledTimes(1));

    // Two auto-saves, two reads: the first one answers last, with the older text.
    let answerOld: (value: unknown) => void = () => {};
    getEventRekoSummaries.mockReturnValueOnce(new Promise((resolve) => { answerOld = resolve; }));
    getEventRekoSummaries.mockResolvedValueOnce(respond(summary("a", "2026-10-06T08:00:00Z", { summary_text: "Keller 20 cm" })));
    await act(async () => { wsHandlers.get("reko_update")?.(); wsHandlers.get("reko_update")?.(); });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("a", expect.objectContaining({ summaryText: "Keller 20 cm" })));
    await act(async () => { answerOld(respond(summary("a", "2026-10-06T08:00:00Z", { summary_text: "Keller" }))); });

    expect(onUpdate).toHaveBeenLastCalledWith("a", expect.objectContaining({ summaryText: "Keller 20 cm" }));
  });
});

describe("withRekoSummary", () => {
  it("sets the summary only – the card's status stays the server's (pass 5, S1)", () => {
    const card = makeOperation({ id: "a", status: "reko", hasCompletedReko: true });
    const rekoSummary = { isRelevant: true, summaryText: "Keller 20 cm" } as unknown as RekoSummary;

    const [after] = withRekoSummary([card], "a", rekoSummary);

    expect(after.status).toBe("reko");
    expect(after.rekoSummary).toBe(rekoSummary);
  });
});


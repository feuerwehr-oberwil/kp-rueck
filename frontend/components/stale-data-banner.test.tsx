import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import type { WebSocketStatus } from "@/lib/websocket-client";

let mockLastSyncAt: Date | null = null;
let mockLoadError: Error | null = null;
let mockWsStatus: WebSocketStatus = "disconnected";
let statusListener: ((status: WebSocketStatus) => void) | null = null;
let mockRestReachable = true;
let restListener: ((reachable: boolean) => void) | null = null;
let mockPathname = "/map";
const refreshOperations = vi.fn(async () => {});

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ refreshOperations }),
  useBoardSyncStatus: () => ({ lastSyncAt: mockLastSyncAt, loadError: mockLoadError }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@/lib/websocket-client", () => ({
  wsClient: {
    reconnect: vi.fn(),
    getStatus: () => mockWsStatus,
    onStatusChange: (cb: (s: WebSocketStatus) => void) => {
      statusListener = cb;
      cb(mockWsStatus);
      return () => {
        statusListener = null;
      };
    },
  },
}));

vi.mock("@/lib/api-client", () => ({
  getRestReachable: () => mockRestReachable,
  onRestReachableChange: (cb: (reachable: boolean) => void) => {
    restListener = cb;
    return () => {
      restListener = null;
    };
  },
}));

import { StaleDataBanner } from "@/components/stale-data-banner";

beforeEach(() => {
  mockLastSyncAt = null;
  mockLoadError = null;
  mockWsStatus = "disconnected";
  statusListener = null;
  mockRestReachable = true;
  restListener = null;
  mockPathname = "/map";
  refreshOperations.mockClear();
});

describe("StaleDataBanner", () => {
  it("renders nothing while the WebSocket is connected", () => {
    mockWsStatus = "connected";
    mockLastSyncAt = new Date(Date.now() - 10 * 60_000);
    const { container } = renderWithIntl(<StaleDataBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there has never been a successful sync", () => {
    mockWsStatus = "disconnected";
    mockLastSyncAt = null;
    const { container } = renderWithIntl(<StaleDataBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the warning when WS is disconnected and last sync is stale", () => {
    mockWsStatus = "disconnected";
    mockLastSyncAt = new Date(Date.now() - 60_000);
    renderWithIntl(<StaleDataBanner />);
    expect(
      screen.getByText(/Verbindung verloren/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Polling läuft/i);
  });

  it("shows after a failed board load even while the WebSocket is connected", () => {
    mockWsStatus = "connected";
    mockLastSyncAt = new Date(Date.now() - 60_000);
    mockLoadError = new Error("503");
    renderWithIntl(<StaleDataBanner />);
    expect(screen.getByText(/Aktualisierung fehlgeschlagen/i)).toBeInTheDocument();
  });

  it("names the time of the last good board when a reload fails, and never «Verbindung verloren»", () => {
    // A 500 is an answer: the connection is fine, the board is still stale.
    mockWsStatus = "connected";
    mockLastSyncAt = new Date(2026, 8, 23, 9, 55, 0);
    mockLoadError = new Error("500");
    renderWithIntl(<StaleDataBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Stand 09:55 – Aktualisierung fehlgeschlagen");
    expect(banner).toHaveTextContent("Das Board zeigt den letzten geladenen Stand.");
    expect(banner).not.toHaveTextContent(/Verbindung verloren/i);
  });

  it("reloads the board from the failed-load banner", async () => {
    mockLastSyncAt = new Date(Date.now() - 60_000);
    mockLoadError = new Error("503");
    renderWithIntl(<StaleDataBanner />);
    await act(async () => screen.getByRole("button", { name: "Erneut laden" }).click());
    expect(refreshOperations).toHaveBeenCalledTimes(1);
  });

  it("says the board never loaded on other pages, without naming a last update that never happened", () => {
    mockWsStatus = "connected";
    mockLastSyncAt = null;
    mockLoadError = new Error("timeout");
    mockPathname = "/map";
    renderWithIntl(<StaleDataBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Einsätze konnten nicht geladen werden");
    expect(banner).not.toHaveTextContent(/Stand|Letzte Aktualisierung/i);
  });

  it("stands back on the board when it never loaded — the board's error panel says it", () => {
    mockLastSyncAt = null;
    mockLoadError = new Error("timeout");
    mockPathname = "/";
    const { container } = renderWithIntl(<StaleDataBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows on a REST outage even while the WebSocket claims connected", () => {
    mockWsStatus = "connected";
    mockLastSyncAt = new Date(Date.now() - 2_000);
    mockRestReachable = false;
    renderWithIntl(<StaleDataBanner />);
    expect(screen.getByText(/Verbindung verloren/i)).toBeInTheDocument();
  });

  it("hides again when the api-client reports REST reachable", () => {
    mockWsStatus = "connected";
    mockLastSyncAt = new Date(Date.now() - 2_000);
    mockRestReachable = false;
    renderWithIntl(<StaleDataBanner />);
    expect(screen.getByText(/Verbindung verloren/i)).toBeInTheDocument();

    act(() => {
      mockRestReachable = true;
      restListener?.(true);
    });

    expect(screen.queryByText(/Verbindung verloren/i)).not.toBeInTheDocument();
  });

  it("re-renders when wsClient signals reconnection", () => {
    mockWsStatus = "disconnected";
    mockLastSyncAt = new Date(Date.now() - 60_000);
    renderWithIntl(<StaleDataBanner />);
    expect(screen.getByText(/Verbindung verloren/i)).toBeInTheDocument();

    act(() => {
      mockWsStatus = "connected";
      statusListener?.("connected");
    });

    expect(screen.queryByText(/Verbindung verloren/i)).not.toBeInTheDocument();
  });
});

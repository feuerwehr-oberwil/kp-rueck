import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, act } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import type { WebSocketStatus } from "@/lib/websocket-client";

let mockLastSyncAt: Date | null = null;
let mockWsStatus: WebSocketStatus = "disconnected";
let statusListener: ((status: WebSocketStatus) => void) | null = null;

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ lastSyncAt: mockLastSyncAt }),
}));

vi.mock("@/lib/websocket-client", () => ({
  wsClient: {
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

import { StaleDataBanner } from "@/components/stale-data-banner";

beforeEach(() => {
  mockLastSyncAt = null;
  mockWsStatus = "disconnected";
  statusListener = null;
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

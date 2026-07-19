import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

const mockPush = vi.fn();
const mockLogin = vi.fn();
const mockSetSelectedEvent = vi.fn();
const mockCreateDemoSandbox = vi.fn();
const mockGetEvent = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => ({ login: mockLogin }),
}));

vi.mock("@/lib/contexts/event-context", () => ({
  useEvent: () => ({ setSelectedEvent: mockSetSelectedEvent }),
  apiEventToEvent: (apiEvent: { id: string; name: string }) => ({
    id: apiEvent.id,
    name: apiEvent.name,
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  getMicrosoftAuthConfig: () => Promise.resolve(null),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getDemoStatus: () =>
      Promise.resolve({
        demo: true,
        next_reset: null,
        seconds_until_reset: 3600,
        reset_interval_hours: 2,
      }),
    createDemoSandbox: (...args: unknown[]) => mockCreateDemoSandbox(...args),
    getEvent: (...args: unknown[]) => mockGetEvent(...args),
  },
}));

import LoginPage from "./page";

const SANDBOX_EVENT_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  mockLogin.mockResolvedValue(undefined);
  mockCreateDemoSandbox.mockResolvedValue({
    event_id: SANDBOX_EVENT_ID,
    name: "Demo-Lage #ab12",
    reused: false,
  });
  mockGetEvent.mockResolvedValue({
    id: SANDBOX_EVENT_ID,
    name: "Demo-Lage #ab12",
    training_flag: false,
    created_at: "2026-06-11T10:00:00Z",
    updated_at: "2026-06-11T10:00:00Z",
    archived_at: null,
    last_activity_at: "2026-06-11T10:00:00Z",
    incident_count: 12,
  });
});

describe("LoginPage demo sandbox flow", () => {
  it("creates a sandbox and selects it on demo-editor login", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LoginPage />);

    await user.click(await screen.findByRole("button", { name: /Als Editor einloggen/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockLogin).toHaveBeenCalledWith("demo-editor", "demo123");
    expect(mockCreateDemoSandbox).toHaveBeenCalledTimes(1);
    expect(mockSetSelectedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: SANDBOX_EVENT_ID }),
    );
  });

  it("still navigates when the sandbox call fails", async () => {
    mockCreateDemoSandbox.mockRejectedValue(new Error("429 Too Many Requests"));
    const user = userEvent.setup();
    renderWithIntl(<LoginPage />);

    await user.click(await screen.findByRole("button", { name: /Als Editor einloggen/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockSetSelectedEvent).not.toHaveBeenCalled();
    // No error message shown — sandbox is best-effort
    expect(screen.queryByText(/fehlgeschlagen/i)).not.toBeInTheDocument();
  });

  it("does not create a sandbox on demo-viewer login", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LoginPage />);

    await user.click(await screen.findByRole("button", { name: /Als Betrachter einloggen/i }));

    // Viewer logins land on the read-only board, not the editor kanban.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/viewer"));
    expect(mockLogin).toHaveBeenCalledWith("demo-viewer", "demo123");
    expect(mockCreateDemoSandbox).not.toHaveBeenCalled();
    expect(mockSetSelectedEvent).not.toHaveBeenCalled();
  });
});

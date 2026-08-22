import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockLogin = vi.fn();
const mockSetSelectedEvent = vi.fn();
const mockCreateDemoSandbox = vi.fn();
const mockGetEvent = vi.fn();
const mockGetSetupStatus = vi.fn();
const mockGetDemoStatus = vi.fn();
const mockGetMicrosoftAuthConfig = vi.fn();

// Stable like the real Next router — the setup-status effect depends on it.
const mockRouter = { push: mockPush, replace: mockReplace };
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
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
  getMicrosoftAuthConfig: (...args: unknown[]) => mockGetMicrosoftAuthConfig(...args),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getDemoStatus: (...args: unknown[]) => mockGetDemoStatus(...args),
    createDemoSandbox: (...args: unknown[]) => mockCreateDemoSandbox(...args),
    getEvent: (...args: unknown[]) => mockGetEvent(...args),
    getSetupStatus: (...args: unknown[]) => mockGetSetupStatus(...args),
  },
}));

import LoginPage from "./page";

const SANDBOX_EVENT_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetupStatus.mockResolvedValue({ claimed: true });
  mockGetDemoStatus.mockResolvedValue({
    demo: true,
    next_reset: null,
    seconds_until_reset: 3600,
    reset_interval_hours: 2,
  });
  mockGetMicrosoftAuthConfig.mockResolvedValue(null);
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

  it("creates its own sandbox on demo-viewer login", async () => {
    const user = userEvent.setup();
    renderWithIntl(<LoginPage />);

    await user.click(await screen.findByRole("button", { name: /Als Betrachter einloggen/i }));

    // Viewers also get their own Demo-Lage (not a shared base event), then land
    // on the read-only board.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/display/board"));
    expect(mockLogin).toHaveBeenCalledWith("demo-viewer", "demo123");
    expect(mockCreateDemoSandbox).toHaveBeenCalled();
    expect(mockSetSelectedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: SANDBOX_EVENT_ID }),
    );
  });
});

describe("LoginPage first-run gating", () => {
  it("redirects to /setup while the board is unclaimed", async () => {
    mockGetSetupStatus.mockResolvedValue({ claimed: false });
    renderWithIntl(<LoginPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/setup"));
  });

  it("stays a login page when the setup status cannot be read (fail open)", async () => {
    // getSetupStatus swallows network errors into null — an unreachable
    // backend must never lock a working station out of its login.
    mockGetSetupStatus.mockResolvedValue(null);
    renderWithIntl(<LoginPage />);

    await screen.findByRole("button", { name: /Als Editor einloggen/i });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

/**
 * Both ways in are on screen at once. The password form used to hide behind a
 * «Mit Passwort anmelden» link whenever Entra ID was configured, which cost a click
 * on every login for the accounts that have no Entra ID at all — the Magazin display,
 * the shared editor account, and everyone during an outage of the identity provider.
 */
describe("LoginPage – beide Anmeldewege", () => {
  beforeEach(() => {
    mockGetDemoStatus.mockResolvedValue({
      demo: false,
      next_reset: null,
      seconds_until_reset: 0,
      reset_interval_hours: 0,
    });
  });

  it("shows the password form next to the Microsoft button, without a click", async () => {
    mockGetMicrosoftAuthConfig.mockResolvedValue({
      client_id: "c",
      tenant_id: "t",
      redirect_uri: "https://kp.example.li/auth/callback",
    });
    renderWithIntl(<LoginPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Mit Microsoft anmelden/i })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/Benutzername/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Passwort/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Anmelden$/i })).toBeInTheDocument();
  });

  it("shows the password form when no identity provider is configured", async () => {
    mockGetMicrosoftAuthConfig.mockResolvedValue(null);
    renderWithIntl(<LoginPage />);

    await waitFor(() => expect(screen.getByLabelText(/Benutzername/i)).toBeInTheDocument());
    expect(
      screen.queryByRole("button", { name: /Mit Microsoft anmelden/i }),
    ).not.toBeInTheDocument();
  });
});

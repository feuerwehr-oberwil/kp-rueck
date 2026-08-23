import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseAuth = vi.fn();
let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("@/lib/contexts/auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

// Everything the shell mounts besides the palette is irrelevant here and pulls in
// half the app's contexts — stub it down to the one thing under test.
vi.mock("@/components/ui/command-palette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));
vi.mock("@/components/demo-banner", () => ({ DemoBanner: () => null }));
vi.mock("@/components/deployment-banner", () => ({ DeploymentBanner: () => null }));
vi.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
vi.mock("@/components/incident-truncation-banner", () => ({
  IncidentTruncationBanner: () => null,
}));
vi.mock("@/components/notifications/persistent-notification-sidebar", () => ({
  PersistentNotificationSidebar: () => null,
}));

import { AppShell } from "@/components/app-shell";

beforeEach(() => {
  pathname = "/";
  mockUseAuth.mockReturnValue({ isAuthenticated: false });
});

/**
 * ⌘K used to work on the login screen and on the public phone forms, because the
 * palette was mounted for everybody. It lists the board's actions and the names of
 * the open Aufträge — none of which is public, and a keyboard shortcut is not an
 * access control. Gating the MOUNT (not the handler) is what also removes the
 * document-level `keydown` listener and the `kp:open-command-palette` listener.
 */
describe("AppShell – Kommandopalette", () => {
  it("does not mount the palette while signed out", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("does not mount it on the public phone forms either", () => {
    pathname = "/alarm";
    render(<AppShell>content</AppShell>);
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("mounts it once signed in", () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true });
    render(<AppShell>content</AppShell>);
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });
});

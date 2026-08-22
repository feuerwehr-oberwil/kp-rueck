import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";

const getAllSettings = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAllSettings: (...args: unknown[]) => getAllSettings(...args),
    updateSetting: vi.fn(),
    exportEventLageblatt: vi.fn(),
  },
}));

vi.mock("@/lib/contexts/event-context", () => ({
  useEvent: () => ({ selectedEvent: null }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { FallbackSettings } from "@/components/settings/fallback-settings";

const autoPrintSwitch = () =>
  screen.getByRole("switch", { name: /Board automatisch drucken/i });

beforeEach(() => {
  getAllSettings.mockReset();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
});

/**
 * «Board automatisch drucken (Thermo)» without a thermal printer is a switch that flips
 * and prints nothing. Both halves of the dependency are checked: the printer switched on
 * AND an address the print agent can reach.
 */
describe("FallbackSettings – Thermo-Autodruck", () => {
  it("locks the switch, with a reason, while no printer is configured", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "false", "printer.ip": "" });
    renderWithIntl(<FallbackSettings />);

    await waitFor(() => expect(autoPrintSwitch()).toBeDisabled());
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("locks it when printing is on but no address is stored", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "true", "printer.ip": "  " });
    renderWithIntl(<FallbackSettings />);

    await waitFor(() => expect(autoPrintSwitch()).toBeDisabled());
  });

  it("keeps a stored 'on' visible while locked", async () => {
    getAllSettings.mockResolvedValue({
      "fallback.auto_print_enabled": "true",
      "printer.enabled": "false",
      "printer.ip": "",
    });
    renderWithIntl(<FallbackSettings />);

    await waitFor(() => expect(autoPrintSwitch()).toBeDisabled());
    expect(autoPrintSwitch()).toBeChecked();
  });

  it("unlocks once the printer is enabled and has an address", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "true", "printer.ip": "10.10.10.230" });
    renderWithIntl(<FallbackSettings />);

    await waitFor(() => expect(autoPrintSwitch()).toBeEnabled());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";

const getIntegrations = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getIntegrations: (...args: unknown[]) => getIntegrations(...args),
  },
}));

import { GpsSettingsCard } from "@/components/settings/gps-settings";
import { resetIntegrationsCache } from "@/lib/hooks/use-integrations";

const capability = (configured: boolean) => ({
  alarms: { provider: null, display_name: null, configured: false, capabilities: [] },
  alerting: { provider: null, display_name: null, configured: false, capabilities: [] },
  personnel: { provider: null, display_name: null, configured: false, capabilities: [] },
  vehicles: {
    provider: configured ? "traccar" : null,
    display_name: configured ? "Traccar" : null,
    configured,
    capabilities: configured ? ["gps-tracking", "status-automation"] : [],
  },
  builtin_alarm_paths: [],
});

beforeEach(() => {
  resetIntegrationsCache();
  // Default for the older specs below: the registry never answers, which means
  // "we don't know yet" and must lock nothing.
  getIntegrations.mockReset().mockRejectedValue(new Error("offline"));
});

/**
 * Rule B measures against the Magazin coordinates; without them the backend's return
 * check bails out on its first line. So the switch must be visibly locked rather than
 * flippable-and-silent — and a stored "true" must survive the lock.
 */
const renderCard = (settings: Record<string, string>) =>
  renderWithIntl(
    <GpsSettingsCard
      settings={settings}
      serverSettings={settings}
      setSettings={vi.fn()}
      updateSetting={vi.fn()}
      isEditor
      saving={null}
    />,
  );

const returnSwitch = () =>
  screen.getByRole("switch", { name: /Magazin: Freigabe vorschlagen/i });

describe("GpsSettingsCard – Rückkehr-Regel", () => {
  it("locks the Rückkehr switch, with a reason, while the Magazin coordinates are missing", () => {
    renderCard({ "gps.automation_enabled": "true" });

    expect(returnSwitch()).toBeDisabled();
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("keeps a stored 'on' visible while locked", () => {
    renderCard({ "gps.automation_enabled": "true", "gps.rule_return_enabled": "true" });

    expect(returnSwitch()).toBeDisabled();
    expect(returnSwitch()).toBeChecked();
  });

  it("unlocks once both coordinates are set", () => {
    renderCard({
      "gps.automation_enabled": "true",
      "gps.station_lat": "47.4991",
      "gps.station_lng": "7.5487",
    });

    expect(returnSwitch()).toBeEnabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

/**
 * The whole card runs off the Traccar poll (`gps_automation.py` is called from
 * `traccar_poller`). With no tracker configured, nothing it offers can ever fire — so the
 * master switch is locked and says why, instead of flipping and staying silent.
 */
const masterSwitch = () => screen.getByRole("switch", { name: /GPS-Statusautomatik/i });

describe("GpsSettingsCard – Ortungsdienst", () => {
  it("locks the master switch, with a reason, when no tracker is configured", async () => {
    getIntegrations.mockResolvedValue(capability(false));
    renderCard({ "gps.automation_enabled": "false" });

    await waitFor(() => expect(masterSwitch()).toBeDisabled());
    expect(screen.getByRole("note")).toHaveTextContent(/TRACCAR_URL/);
  });

  it("keeps a stored 'on' visible while locked", async () => {
    getIntegrations.mockResolvedValue(capability(false));
    renderCard({ "gps.automation_enabled": "true" });

    await waitFor(() => expect(masterSwitch()).toBeDisabled());
    expect(masterSwitch()).toBeChecked();
  });

  it("leaves the switch alone while the registry has not answered yet", async () => {
    // A control that locks itself half a second after the page loads is worse than one
    // that waits — `null` means unknown, never "not configured".
    getIntegrations.mockReturnValue(new Promise(() => {}));
    renderCard({ "gps.automation_enabled": "false" });

    expect(masterSwitch()).toBeEnabled();
  });

  it("unlocks once a tracker is configured", async () => {
    getIntegrations.mockResolvedValue(capability(true));
    renderCard({ "gps.automation_enabled": "false" });

    await waitFor(() => expect(masterSwitch()).toBeEnabled());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

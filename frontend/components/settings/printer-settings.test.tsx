import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";

const getAllSettings = vi.fn();
const getPrinterStatus = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAllSettings: (...args: unknown[]) => getAllSettings(...args),
    getPrinterStatus: (...args: unknown[]) => getPrinterStatus(...args),
    updateSetting: vi.fn(),
    queueTestPrint: vi.fn(),
    getPrintJob: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { PrinterSettings } from "@/components/settings/printer-settings";

const autoAnfahrtSwitch = () =>
  screen.getByRole("switch", { name: /Einsatzzettel beim Disponieren/i });

beforeEach(() => {
  getAllSettings.mockReset();
  getPrinterStatus.mockReset().mockResolvedValue({ enabled: false, ip: "", port: 9100 });
});

/**
 * The auto-print switch and the two test buttons all need the same thing: printing
 * switched on AND an address the print agent can reach (`GET /api/print/config/`).
 * Missing either, they are locked and say which one.
 */
describe("PrinterSettings – Voraussetzungen", () => {
  it("locks auto-print and the test buttons, with a reason, while printing is off", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "false", "printer.ip": "" });
    renderWithIntl(<PrinterSettings />);

    await waitFor(() => expect(autoAnfahrtSwitch()).toBeDisabled());
    expect(screen.getByRole("button", { name: /Testdruck/i })).toBeDisabled();
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("stays locked when printing is on but no address is stored", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "true", "printer.ip": "" });
    renderWithIntl(<PrinterSettings />);

    await waitFor(() => expect(autoAnfahrtSwitch()).toBeDisabled());
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("keeps a stored 'on' visible while locked", async () => {
    getAllSettings.mockResolvedValue({
      "printer.enabled": "false",
      "printer.ip": "",
      "printer.auto_anfahrt": "true",
    });
    renderWithIntl(<PrinterSettings />);

    await waitFor(() => expect(autoAnfahrtSwitch()).toBeDisabled());
    expect(autoAnfahrtSwitch()).toBeChecked();
  });

  it("unlocks once printing is on and an address is stored", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "true", "printer.ip": "10.10.10.230" });
    renderWithIntl(<PrinterSettings />);

    await waitFor(() => expect(autoAnfahrtSwitch()).toBeEnabled());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

/**
 * «An» and «bereit» are not the same thing. The status card used to answer `printer.enabled`
 * alone, so a station that had never entered an address got a green tick for a system that
 * cannot put anything on paper — and the print-service line below it reported "online" for a
 * service with nowhere to print to.
 */
describe("PrinterSettings – Zustandskarte", () => {
  it("warns instead of confirming when printing is on but no address is stored", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "true", "printer.ip": "" });
    getPrinterStatus.mockResolvedValue({ enabled: true, ip: "", port: 9100, agent_online: true });
    renderWithIntl(<PrinterSettings />);

    await waitFor(() =>
      expect(screen.getByText(/keine Adresse gesetzt/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Print-Service online")).not.toBeInTheDocument();
  });

  it("confirms once both are in place, address and service on one line", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "true", "printer.ip": "10.10.10.230" });
    getPrinterStatus.mockResolvedValue({
      enabled: true,
      ip: "10.10.10.230",
      port: 9100,
      agent_online: true,
    });
    renderWithIntl(<PrinterSettings />);

    // The healthy case is the one that should take the least room: address and
    // print-service ride along as one muted aside, not as a second row.
    await waitFor(() =>
      expect(screen.getByText(/10\.10\.10\.230:9100 · Print-Service online/)).toBeInTheDocument(),
    );
  });

  it("names the print service as the problem when the agent is silent", async () => {
    getAllSettings.mockResolvedValue({ "printer.enabled": "true", "printer.ip": "10.10.10.230" });
    getPrinterStatus.mockResolvedValue({
      enabled: true,
      ip: "10.10.10.230",
      port: 9100,
      agent_online: false,
    });
    renderWithIntl(<PrinterSettings />);

    await waitFor(() => expect(screen.getByText(/Print-Service offline/)).toBeInTheDocument());
  });
});

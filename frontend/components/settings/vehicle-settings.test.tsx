import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

import type { ApiVehicle } from "@/lib/api-client";

const apiVehicle = (overrides: Partial<ApiVehicle> = {}): ApiVehicle => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "TLF 1",
  type: "TLF",
  display_order: 1,
  status: "available",
  radio_call_sign: "Omega 1",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  ...overrides,
});

const getVehicles = vi.fn();
const createVehicle = vi.fn();
const updateVehicle = vi.fn();
const deleteVehicle = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getVehicles: (...args: unknown[]) => getVehicles(...args),
    createVehicle: (...args: unknown[]) => createVehicle(...args),
    updateVehicle: (...args: unknown[]) => updateVehicle(...args),
    deleteVehicle: (...args: unknown[]) => deleteVehicle(...args),
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { VehicleSettings } from "@/components/settings/vehicle-settings";

beforeEach(() => {
  getVehicles.mockReset().mockResolvedValue([]);
  createVehicle.mockReset();
  updateVehicle.mockReset();
  deleteVehicle.mockReset();
  toastError.mockReset();
});

describe("VehicleSettings", () => {
  it("creates a vehicle on happy-path submit", async () => {
    const created = apiVehicle({ name: "Pio", radio_call_sign: "Omega 2", display_order: 1 });
    createVehicle.mockResolvedValue(created);
    getVehicles
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValueOnce([created]); // after create

    const user = userEvent.setup();
    renderWithIntl(<VehicleSettings />);

    await waitFor(() => expect(getVehicles).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Fahrzeug hinzufügen/i }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name$/i), "Pio");
    await user.type(within(dialog).getByLabelText(/Funkrufname/i), "Omega 2");
    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createVehicle).toHaveBeenCalledTimes(1));
    expect(createVehicle).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Pio",
        radio_call_sign: "Omega 2",
        display_order: 1,
        status: "available",
      }),
    );
  });

  it("blocks submit and surfaces a zod error when name is empty", async () => {
    const user = userEvent.setup();
    renderWithIntl(<VehicleSettings />);
    await waitFor(() => expect(getVehicles).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Fahrzeug hinzufügen/i }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Funkrufname/i), "Omega 1");
    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    expect(await within(dialog).findByText(/Name ist erforderlich/i)).toBeInTheDocument();
    expect(createVehicle).not.toHaveBeenCalled();
  });

  it("warns about unsaved changes when cancelling while dirty", async () => {
    const user = userEvent.setup();
    renderWithIntl(<VehicleSettings />);
    await waitFor(() => expect(getVehicles).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Fahrzeug hinzufügen/i }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name$/i), "Halffilled");

    await user.click(within(dialog).getByRole("button", { name: /Abbrechen/i }));

    expect(
      await screen.findByText(/Ungespeicherte Änderungen/i),
    ).toBeInTheDocument();
  });

  it("toasts on API failure and keeps the dialog open", async () => {
    createVehicle.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderWithIntl(<VehicleSettings />);
    await waitFor(() => expect(getVehicles).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Fahrzeug hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name$/i), "Boom");
    await user.type(within(dialog).getByLabelText(/Funkrufname/i), "Omega 9");
    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0]?.[0]).toMatch(/Fehler beim Speichern/i);
    // Dialog should remain open after failure so the operator can retry
    expect(screen.queryByRole("dialog")).toBeInTheDocument();
  });
});

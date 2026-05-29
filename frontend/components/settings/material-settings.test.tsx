import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ApiMaterialResource } from "@/lib/api-client";

const apiMaterial = (
  overrides: Partial<ApiMaterialResource> = {},
): ApiMaterialResource => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Tauchpumpe Gr.",
  type: "Pumpe",
  status: "available",
  location: "TLF",
  location_sort_order: 0,
  consumable: false,
  group_id: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  ...overrides,
});

const getAllMaterials = vi.fn();
const getMaterialGroups = vi.fn();
const createMaterialResource = vi.fn();
const updateMaterialResource = vi.fn();
const deleteMaterialResource = vi.fn();
const updateMaterialCategorySortOrder = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAllMaterials: (...args: unknown[]) => getAllMaterials(...args),
    getMaterialGroups: (...args: unknown[]) => getMaterialGroups(...args),
    createMaterialResource: (...args: unknown[]) =>
      createMaterialResource(...args),
    updateMaterialResource: (...args: unknown[]) =>
      updateMaterialResource(...args),
    deleteMaterialResource: (...args: unknown[]) =>
      deleteMaterialResource(...args),
    updateMaterialCategorySortOrder: (...args: unknown[]) =>
      updateMaterialCategorySortOrder(...args),
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { MaterialSettings } from "@/components/settings/material-settings";

beforeEach(() => {
  getAllMaterials.mockReset().mockResolvedValue([]);
  getMaterialGroups.mockReset().mockResolvedValue([]);
  createMaterialResource.mockReset();
  updateMaterialResource.mockReset();
  deleteMaterialResource.mockReset();
  updateMaterialCategorySortOrder.mockReset();
  toastError.mockReset();
});

describe("MaterialSettings", () => {
  it("creates a material on happy-path submit (consumable off by default)", async () => {
    createMaterialResource.mockResolvedValue(apiMaterial());
    const user = userEvent.setup();
    render(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name$/i), "Tauchpumpe");
    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createMaterialResource).toHaveBeenCalledTimes(1));
    expect(createMaterialResource).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Tauchpumpe",
        status: "available",
        consumable: false,
      }),
    );
  });

  it("blocks submit when name is empty", async () => {
    const user = userEvent.setup();
    render(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    expect(await within(dialog).findByText(/Name ist erforderlich/i)).toBeInTheDocument();
    expect(createMaterialResource).not.toHaveBeenCalled();
  });

  it("warns about unsaved changes when cancelling while dirty", async () => {
    const user = userEvent.setup();
    render(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name$/i), "Halffilled");
    await user.click(within(dialog).getByRole("button", { name: /Abbrechen/i }));

    expect(await screen.findByText(/Ungespeicherte Änderungen/i)).toBeInTheDocument();
  });

  it("toggles consumable via switch and submits with the new value", async () => {
    createMaterialResource.mockResolvedValue(apiMaterial({ consumable: true }));
    const user = userEvent.setup();
    render(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name$/i), "Flatterband");

    const consumableSwitch = within(dialog).getByRole("switch");
    await user.click(consumableSwitch);

    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createMaterialResource).toHaveBeenCalledTimes(1));
    expect(createMaterialResource).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Flatterband", consumable: true }),
    );
  });
});

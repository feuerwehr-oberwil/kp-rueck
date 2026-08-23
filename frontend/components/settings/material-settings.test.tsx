import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
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
  out_of_service: false,
  out_of_service_since: null,
  archived_at: null,
  assignment_count: 0,
  can_delete: true,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  ...overrides,
});

const getAllMaterials = vi.fn();
const getMaterialGroups = vi.fn();
const createMaterialResource = vi.fn();
const updateMaterialResource = vi.fn();
const deleteMaterialResource = vi.fn();
const archiveMaterialResource = vi.fn();
const restoreMaterialResource = vi.fn();
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
    archiveMaterialResource: (...args: unknown[]) =>
      archiveMaterialResource(...args),
    restoreMaterialResource: (...args: unknown[]) =>
      restoreMaterialResource(...args),
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
  archiveMaterialResource.mockReset().mockResolvedValue(apiMaterial());
  restoreMaterialResource.mockReset().mockResolvedValue(apiMaterial());
  updateMaterialCategorySortOrder.mockReset();
  toastError.mockReset();
});

describe("MaterialSettings", () => {
  it("creates a material on happy-path submit (consumable off by default)", async () => {
    createMaterialResource.mockResolvedValue(apiMaterial());
    const user = userEvent.setup();
    renderWithIntl(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name\s*\*?$/i), "Tauchpumpe");
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
    renderWithIntl(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    expect(await within(dialog).findByText(/Name ist erforderlich/i)).toBeInTheDocument();
    expect(createMaterialResource).not.toHaveBeenCalled();
  });

  it("warns about unsaved changes when cancelling while dirty", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name\s*\*?$/i), "Halffilled");
    await user.click(within(dialog).getByRole("button", { name: /Abbrechen/i }));

    expect(await screen.findByText(/Ungespeicherte Änderungen/i)).toBeInTheDocument();
  });

  it("toggles consumable via switch and submits with the new value", async () => {
    createMaterialResource.mockResolvedValue(apiMaterial({ consumable: true }));
    const user = userEvent.setup();
    renderWithIntl(<MaterialSettings />);
    await waitFor(() => expect(getAllMaterials).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name\s*\*?$/i), "Flatterband");

    const consumableSwitch = within(dialog).getByRole("switch");
    await user.click(consumableSwitch);

    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createMaterialResource).toHaveBeenCalledTimes(1));
    expect(createMaterialResource).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Flatterband", consumable: true }),
    );
  });

  // Selecting by position rather than by label on purpose: these assert what the
  // buttons DO, and the labels are the part most likely to be reworded.
  const rowButtons = (name: RegExp) =>
    within(screen.getByRole("row", { name })).getAllByRole("button");

  it("retires a device by archiving it, not by deleting it", async () => {
    getAllMaterials.mockResolvedValue([apiMaterial()]);
    const user = userEvent.setup();
    renderWithIntl(<MaterialSettings />);
    await screen.findByText("Tauchpumpe Gr.");

    // [0] = edit, [1] = retire.
    await user.click(rowButtons(/Tauchpumpe Gr\./)[1]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getAllByRole("button").at(-1) as HTMLElement,
    );

    await waitFor(() => expect(archiveMaterialResource).toHaveBeenCalledTimes(1));
    expect(deleteMaterialResource).not.toHaveBeenCalled();
  });

  it("writes «nicht einsatzbereit» as the out_of_service field", async () => {
    getAllMaterials.mockResolvedValue([apiMaterial()]);
    updateMaterialResource.mockResolvedValue(apiMaterial({ out_of_service: true }));
    const user = userEvent.setup();
    renderWithIntl(<MaterialSettings />);
    await screen.findByText("Tauchpumpe Gr.");

    // [0] = «Archivierte anzeigen», [1] = the row's readiness flag.
    await user.click(screen.getAllByRole("checkbox")[1]);

    await waitFor(() => expect(updateMaterialResource).toHaveBeenCalledTimes(1));
    expect(updateMaterialResource).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      { out_of_service: true },
    );
  });

  it("greys the permanent delete on the API's own can_delete", async () => {
    getAllMaterials.mockResolvedValue([
      apiMaterial({
        name: "Alte Pumpe",
        archived_at: "2026-08-22T10:00:00Z",
        assignment_count: 14,
        can_delete: false,
      }),
    ]);
    const user = userEvent.setup();
    renderWithIntl(<MaterialSettings />);

    await user.click(screen.getAllByRole("checkbox")[0]);
    await screen.findByText("Alte Pumpe");

    // [0] = «Zurückholen», [1] = «Endgültig löschen».
    const buttons = rowButtons(/Alte Pumpe/);
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
  });
});

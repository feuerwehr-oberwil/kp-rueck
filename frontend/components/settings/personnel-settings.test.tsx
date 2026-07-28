import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

import type { ApiPersonnel } from "@/lib/api-client";

const apiPerson = (overrides: Partial<ApiPersonnel> = {}): ApiPersonnel => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Müller Stefan",
  role: "Offizier",
  role_sort_order: 0,
  availability: "available",
  tags: [],
  checked_in: true,
  checked_in_at: "2026-05-01T00:00:00Z",
  checked_out_at: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  ...overrides,
});

const getAllPersonnel = vi.fn();
const createPersonnel = vi.fn();
const updatePersonnel = vi.fn();
const deletePersonnel = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAllPersonnel: (...args: unknown[]) => getAllPersonnel(...args),
    createPersonnel: (...args: unknown[]) => createPersonnel(...args),
    updatePersonnel: (...args: unknown[]) => updatePersonnel(...args),
    deletePersonnel: (...args: unknown[]) => deletePersonnel(...args),
    updatePersonnelCategorySortOrder: vi.fn(),
    getDiveraSyncPreview: vi.fn(),
    executeDiveraSync: vi.fn(),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { PersonnelSettings } from "@/components/settings/personnel-settings";

beforeEach(() => {
  getAllPersonnel.mockReset().mockResolvedValue([]);
  createPersonnel.mockReset();
  updatePersonnel.mockReset();
  deletePersonnel.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("PersonnelSettings", () => {
  it("creates a person on happy-path submit", async () => {
    createPersonnel.mockResolvedValue(apiPerson({ name: "Müller Stefan" }));
    const user = userEvent.setup();
    renderWithIntl(<PersonnelSettings />);
    await waitFor(() => expect(getAllPersonnel).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Personal hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name\s*\*?$/i), "Müller Stefan");
    await user.type(within(dialog).getByLabelText(/Rolle/i), "Offizier");
    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createPersonnel).toHaveBeenCalledTimes(1));
    expect(createPersonnel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Müller Stefan",
        role: "Offizier",
        availability: "available",
        tags: [],
      }),
    );
  });

  it("warns about unsaved changes when cancelling while dirty", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PersonnelSettings />);
    await waitFor(() => expect(getAllPersonnel).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Personal hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name\s*\*?$/i), "Halffilled");
    await user.click(within(dialog).getByRole("button", { name: /Abbrechen/i }));

    expect(await screen.findByText(/Ungespeicherte Änderungen/i)).toBeInTheDocument();
  });

  it("adds and removes a custom tag before submit", async () => {
    createPersonnel.mockResolvedValue(apiPerson());
    const user = userEvent.setup();
    renderWithIntl(<PersonnelSettings />);
    await waitFor(() => expect(getAllPersonnel).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Personal hinzufügen/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name\s*\*?$/i), "Müller Stefan");
    await user.type(within(dialog).getByLabelText(/Rolle/i), "Offizier");

    const tagInput = within(dialog).getByPlaceholderText(/Neuer Tag/i);
    await user.type(tagInput, "Atemschutz");
    await user.click(within(dialog).getByRole("button", { name: /Hinzufügen/i }));

    await user.click(within(dialog).getByRole("button", { name: /Erstellen/i }));

    await waitFor(() => expect(createPersonnel).toHaveBeenCalledTimes(1));
    expect(createPersonnel).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["Atemschutz"] }),
    );
  });
});

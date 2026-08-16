import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

import type { ApiAuftragTemplate } from "@/lib/api-client";

const VEHICLE_ID = "22222222-2222-2222-2222-222222222222";

const template = (overrides: Partial<ApiAuftragTemplate> = {}): ApiAuftragTemplate => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Sturmholz",
  color: "#10b981",
  notes: "Fahrbahn freihalten",
  auto_create: true,
  position: 0,
  resources: [],
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  ...overrides,
});

const getAuftragTemplates = vi.fn();
const createAuftragTemplate = vi.fn();
const updateAuftragTemplate = vi.fn();
const deleteAuftragTemplate = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAuftragTemplates: (...args: unknown[]) => getAuftragTemplates(...args),
    createAuftragTemplate: (...args: unknown[]) => createAuftragTemplate(...args),
    updateAuftragTemplate: (...args: unknown[]) => updateAuftragTemplate(...args),
    deleteAuftragTemplate: (...args: unknown[]) => deleteAuftragTemplate(...args),
    reorderAuftragTemplates: vi.fn(),
    getVehicles: () => Promise.resolve([{ id: VEHICLE_ID, name: "TLF 1" }]),
    getAllMaterials: () => Promise.resolve([]),
  },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

import { AuftragTemplateSettings } from "@/components/settings/auftrag-template-settings";

beforeEach(() => {
  getAuftragTemplates.mockReset().mockResolvedValue([]);
  createAuftragTemplate.mockReset();
  updateAuftragTemplate.mockReset();
  deleteAuftragTemplate.mockReset();
  toastError.mockReset();
});

describe("AuftragTemplateSettings", () => {
  it("flips a Vorlage between automatic and on-demand", async () => {
    getAuftragTemplates.mockResolvedValue([template()]);
    updateAuftragTemplate.mockResolvedValue(template({ auto_create: false }));
    const user = userEvent.setup();
    renderWithIntl(<AuftragTemplateSettings />);
    await screen.findByText("Sturmholz");

    expect(screen.getByText("Bei jeder Lage")).toBeInTheDocument();
    await user.click(screen.getByRole("switch"));

    await waitFor(() => expect(updateAuftragTemplate).toHaveBeenCalledTimes(1));
    expect(updateAuftragTemplate).toHaveBeenCalledWith(template().id, { auto_create: false });
    expect(await screen.findByText("Nur auf Abruf")).toBeInTheDocument();
  });

  it("adds a vehicle to the Vorlage's Standard-Ressourcen", async () => {
    getAuftragTemplates.mockResolvedValue([template()]);
    updateAuftragTemplate.mockResolvedValue(
      template({ resources: [{ resource_type: "vehicle", resource_id: VEHICLE_ID }] }),
    );
    const user = userEvent.setup();
    renderWithIntl(<AuftragTemplateSettings />);

    await user.click(await screen.findByRole("button", { name: /Sturmholz/ }));
    await user.click(screen.getByRole("button", { name: "Ressource" }));
    await user.click(await screen.findByRole("option", { name: /TLF 1/ }));

    await waitFor(() => expect(updateAuftragTemplate).toHaveBeenCalledTimes(1));
    expect(updateAuftragTemplate).toHaveBeenCalledWith(template().id, {
      resources: [{ resource_type: "vehicle", resource_id: VEHICLE_ID }],
    });
    expect(await screen.findByText("TLF 1")).toBeInTheDocument();
  });

  it("keeps a Vorlage a Vorlage when the server rejects the change", async () => {
    getAuftragTemplates.mockResolvedValue([template()]);
    updateAuftragTemplate.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderWithIntl(<AuftragTemplateSettings />);
    await screen.findByText("Sturmholz");

    await user.click(screen.getByRole("switch"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // The optimistic flip is rolled back — the switch must not claim a state the
    // station does not actually have when the next Lage opens.
    expect(screen.getByText("Bei jeder Lage")).toBeInTheDocument();
  });

  it("creates a Vorlage and opens it for editing", async () => {
    const created = template({ id: "33333333-3333-3333-3333-333333333333", name: "Absperren" });
    createAuftragTemplate.mockResolvedValue(created);
    const user = userEvent.setup();
    renderWithIntl(<AuftragTemplateSettings />);
    await screen.findByText(/Noch keine Standard-Aufträge/);

    await user.type(screen.getByPlaceholderText("Name der Vorlage"), "Absperren");
    await user.click(screen.getByRole("button", { name: "Vorlage" }));

    await waitFor(() => expect(createAuftragTemplate).toHaveBeenCalledTimes(1));
    expect(createAuftragTemplate).toHaveBeenCalledWith({ name: "Absperren", color: "#ef4444" });
    // A bare name is not a Vorlage yet, so the row opens straight into its detail.
    expect(await screen.findByText("Standard-Ressourcen")).toBeInTheDocument();
  });

  it("disables every control in read-only mode", async () => {
    getAuftragTemplates.mockResolvedValue([template()]);
    renderWithIntl(<AuftragTemplateSettings readOnly />);
    await screen.findByText("Sturmholz");

    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByPlaceholderText("Name der Vorlage")).toBeDisabled();
  });

  it("names a resource that has since been deleted instead of hiding it", async () => {
    getAuftragTemplates.mockResolvedValue([
      template({ resources: [{ resource_type: "material", resource_id: "gone" }] }),
    ]);
    const user = userEvent.setup();
    renderWithIntl(<AuftragTemplateSettings />);

    await user.click(await screen.findByRole("button", { name: /Sturmholz/ }));
    // Silently dropping it would leave the station wondering why the next Lage
    // opens short of a piece of equipment it thinks it configured.
    expect(await screen.findByText("Gelöschte Ressource")).toBeInTheDocument();
  });
});

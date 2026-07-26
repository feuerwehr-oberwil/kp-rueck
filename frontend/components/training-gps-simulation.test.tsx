import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import userEvent from "@testing-library/user-event";

const mockVehicles = [
  { id: "v-pio", name: "Pio", type: "Pio", display_order: 3, status: "available", radio_call_sign: "", created_at: "", updated_at: "" },
  { id: "v-tlf", name: "TLF", type: "TLF", display_order: 1, status: "available", radio_call_sign: "", created_at: "", updated_at: "" },
];

const mockState = vi.hoisted(() => ({ drives: [] as unknown[], demo: null as unknown }));
const startGpsSimulation = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/lib/contexts/event-context", () => ({
  useEvent: () => ({ selectedEvent: { id: "e1", training_flag: true } }),
}));
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ operations: [] }),
}));
vi.mock("@/lib/websocket-client", () => ({
  wsClient: { on: () => () => {} },
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getVehicles: async () => mockVehicles,
    getGpsSimulations: async () => mockState.drives,
    getDemoStatus: async () => mockState.demo,
    startGpsSimulation,
    stopGpsSimulation: vi.fn(async () => ({ stopped: 1 })),
    setGpsSimulationSpeed: vi.fn(async () => ({})),
  },
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { TrainingGpsSimulation } from "@/components/training-gps-simulation";

beforeEach(() => {
  mockState.drives = [];
  mockState.demo = null;
  startGpsSimulation.mockClear();
});

describe("TrainingGpsSimulation drive rows", () => {
  it("magazin drive row shows progress + Stopp, no Rückfahrt button", async () => {
    mockState.drives = [
      {
        vehicle_id: "v-pio",
        vehicle_name: "Pio",
        target_label: "Magazin",
        kind: "magazin",
        progress: 0.25,
        eta_seconds: 31,
        speed_kmh: 30,
        started_at: new Date().toISOString(),
      },
    ];
    const { container } = renderWithIntl(<TrainingGpsSimulation />);
    await waitFor(() => expect(screen.getByText(/Rückkehr Magazin/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Rückfahrt/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stopp/ })).toBeInTheDocument();
    // Exactly the one global tempo slider — nothing slider-like inside the row.
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(1);
  });

  it("arrived incident drive shows Rückfahrt; clicking it starts the return", async () => {
    mockState.drives = [
      {
        vehicle_id: "v-pio",
        vehicle_name: "Pio",
        target_label: "Hauptstrasse 1",
        kind: "incident",
        progress: 1,
        eta_seconds: 0,
        speed_kmh: 30,
        started_at: new Date().toISOString(),
      },
    ];
    renderWithIntl(<TrainingGpsSimulation />);
    const btn = await screen.findByRole("button", { name: /Rückfahrt/ });
    await act(async () => {
      await userEvent.click(btn);
    });
    expect(startGpsSimulation).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle_id: "v-pio", target: "magazin" })
    );
  });

  it("demo mode disables the start buttons and says why", async () => {
    mockState.demo = { demo: true };
    renderWithIntl(<TrainingGpsSimulation />);
    await waitFor(() => expect(screen.getByText(/Im Demo-Modus nicht verfügbar/)).toBeInTheDocument());
    for (const btn of screen.getAllByRole("button", { name: /Fahrt starten/ })) {
      expect(btn).toBeDisabled();
    }
    // The target picker is locked too, so the row can't be armed at all.
    for (const trigger of screen.getAllByRole("combobox")) {
      expect(trigger).toBeDisabled();
    }
  });

  it("outside demo mode the rows stay usable", async () => {
    renderWithIntl(<TrainingGpsSimulation />);
    await waitFor(() => expect(screen.getByText("TLF")).toBeInTheDocument());
    expect(screen.queryByText(/Im Demo-Modus nicht verfügbar/)).not.toBeInTheDocument();
    for (const trigger of screen.getAllByRole("combobox")) {
      expect(trigger).not.toBeDisabled();
    }
  });

  it("vehicles are sorted by display_order (TLF before Pio)", async () => {
    renderWithIntl(<TrainingGpsSimulation />);
    await waitFor(() => expect(screen.getByText("TLF")).toBeInTheDocument());
    const names = Array.from(document.querySelectorAll(".w-24")).map((el) => el.textContent);
    expect(names).toEqual(["TLF", "Pio"]);
  });
});

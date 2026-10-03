import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"
import type { SyncStatusResponse } from "@/types/sync"

vi.mock("@/lib/api-client", () => ({ apiClient: { getSyncConfig: vi.fn(async () => ({ is_production: true })) } }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }))

import { SyncStatusCard } from "./sync-status-card"

const base: SyncStatusResponse = {
  last_sync: null,
  direction: "from_railway",
  railway_healthy: false,
  is_syncing: false,
  records_pending: 0,
}

function renderCard(status: SyncStatusResponse) {
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <SyncStatusCard status={status} isLoading={false} error={null} isStale />
    </NextIntlClientProvider>,
  )
}

describe("SyncStatusCard", () => {
  it("on the Railway instance itself: «Zentrale Instanz», never «Railway offline»", () => {
    renderCard({ ...base, instance_role: "railway", peer_configured: false })
    expect(screen.getByText("Zentrale Instanz")).toBeInTheDocument()
    expect(screen.queryByText("Railway offline")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Railway/ })).not.toBeInTheDocument()
  })

  it("a station without a Railway target is «Nicht eingerichtet»", () => {
    renderCard({ ...base, instance_role: "station", peer_configured: false })
    expect(screen.getByText("Nicht eingerichtet")).toBeInTheDocument()
    expect(screen.queryByText("Railway offline")).not.toBeInTheDocument()
  })

  it("a configured station that cannot reach Railway is still «Railway offline»", () => {
    renderCard({ ...base, instance_role: "station", peer_configured: true })
    expect(screen.getByText("Railway offline")).toBeInTheDocument()
  })
})

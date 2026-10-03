import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"
import { isRailwayConfig, type SyncConfig } from "@/types/sync"

const config = vi.hoisted(() => ({ value: {} as SyncConfig }))
vi.mock("@/lib/api-client", () => ({ apiClient: { getSyncConfig: vi.fn(async () => config.value) } }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SyncConfigCard } from "./sync-config-card"

const base: SyncConfig = { sync_interval_minutes: 2, auto_sync_on_create: true, railway_database_url: "" }

function renderCard(value: SyncConfig) {
  config.value = value
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <SyncConfigCard />
    </NextIntlClientProvider>,
  )
}

describe("SyncConfigCard", () => {
  it("on the Railway instance: no form, just why", async () => {
    renderCard({ ...base, is_production: true, is_railway: true })
    expect(await screen.findByText("Synchronisationsfunktion nur lokal verfügbar")).toBeInTheDocument()
  })

  it("a self-hosted station (ENVIRONMENT=production, not Railway) keeps its sync controls", async () => {
    renderCard({ ...base, is_production: false, is_railway: false })
    expect(await screen.findByText("Railway PostgreSQL Verbindung")).toBeInTheDocument()
    expect(screen.queryByText("Synchronisationsfunktion nur lokal verfügbar")).not.toBeInTheDocument()
  })
})

describe("isRailwayConfig", () => {
  it("prefers the explicit flag and falls back to the historical one", () => {
    expect(isRailwayConfig({ ...base, is_railway: false, is_production: true })).toBe(false)
    expect(isRailwayConfig({ ...base, is_production: true })).toBe(true)
    expect(isRailwayConfig(null)).toBe(false)
  })
})

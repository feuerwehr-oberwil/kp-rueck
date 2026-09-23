import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import fr from "@/messages/fr.json"
import { renderWithIntl } from "@/test-utils/render-with-intl"

let resolveRefresh: (() => void) | null = null
const refreshOperations = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolveRefresh = resolve
    }),
)

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ refreshOperations }),
}))

import { BoardLoadErrorPanel, ResourcesNotLoaded } from "@/components/board-load-error"

beforeEach(() => {
  refreshOperations.mockClear()
  resolveRefresh = null
})

describe("BoardLoadErrorPanel", () => {
  it("says the board is not loaded — not that it is empty", () => {
    renderWithIntl(<BoardLoadErrorPanel />)
    const panel = screen.getByRole("alert")
    expect(panel).toHaveAccessibleName("Einsätze konnten nicht geladen werden")
    expect(panel).toHaveTextContent("Das Board ist nicht leer – es ist noch nicht geladen.")
    // True for a dead network AND a server error, unlike «antwortet nicht».
    expect(panel).toHaveTextContent("nicht geantwortet oder einen Fehler gemeldet")
    // No invented countdown: nothing in the scheduler keeps a due time.
    expect(panel).not.toHaveTextContent(/Nächster automatischer Versuch/)
  })

  it("retries the board load, and holds the button while the load runs", async () => {
    renderWithIntl(<BoardLoadErrorPanel />)
    const button = screen.getByRole("button", { name: "Erneut laden" })
    await act(async () => button.click())
    expect(refreshOperations).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    await act(async () => resolveRefresh?.())
    expect(button).toBeEnabled()
  })

  it("speaks French", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Zurich">
        <BoardLoadErrorPanel />
      </NextIntlClientProvider>,
    )
    expect(screen.getByRole("alert")).toHaveAccessibleName("Impossible de charger les interventions")
    expect(screen.getByRole("button", { name: "Recharger" })).toBeInTheDocument()
  })
})

describe("ResourcesNotLoaded", () => {
  it("renders its label", () => {
    renderWithIntl(<ResourcesNotLoaded label="Nicht geladen" />)
    expect(screen.getByText("Nicht geladen")).toBeInTheDocument()
  })
})

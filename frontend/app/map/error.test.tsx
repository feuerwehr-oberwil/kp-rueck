import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import { renderWithIntl } from "@/test-utils/render-with-intl"

const reportClientError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/report-error", () => ({ reportClientError }))

import MapError from "./error"

describe("Lagekarte error screen", () => {
  it("names the reason outside development too, and still reports it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const error = Object.assign(new TypeError("Cannot read properties of undefined (reading 'x')"), { digest: "d1" })
    renderWithIntl(<MapError error={error} reset={() => {}} />)

    expect(screen.getByText("Cannot read properties of undefined (reading 'x') · d1")).toBeInTheDocument()
    expect(screen.queryByText(/Netzwerkproblem/)).not.toBeInTheDocument()
    expect(reportClientError).toHaveBeenCalledWith(error, { kind: "render" })
  })
})

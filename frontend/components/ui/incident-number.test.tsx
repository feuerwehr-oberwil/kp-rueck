import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { renderWithIntl } from "@/test-utils/render-with-intl"

import { IncidentNumber } from "./incident-number"

describe("IncidentNumber", () => {
  it("shows the number with its meaning on hover", () => {
    renderWithIntl(<IncidentNumber number={14} />)
    expect(screen.getByText("14")).toHaveAttribute("title", "Einsatz 14")
  })

  it("renders nothing without a number", () => {
    const { container } = renderWithIntl(<IncidentNumber number={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

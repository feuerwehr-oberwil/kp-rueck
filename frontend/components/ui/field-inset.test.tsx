import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import { DENSE_CONTROL } from "@/components/kanban/detail-field"
import { renderWithIntl } from "@/test-utils/render-with-intl"

/**
 * Owner 03.10.: a text field's first letter started closer to the edge than
 * the select under it. Every text-like control takes its horizontal inset
 * from ONE token, `--field-px` (globals.css) — no primitive picks its own.
 */
const OWN_PX = /(?<![\w:-])(px|pl|pr)-(?!\(--field-px\))[\d.[]/

describe("one field inset", () => {
  it("Input, Textarea and SelectTrigger all use --field-px", () => {
    render(
      <>
        <Input aria-label="Ort" />
        <Textarea aria-label="Meldung" />
        <Select>
          <SelectTrigger aria-label="Einsatzart">
            <SelectValue placeholder="Einsatzart" />
          </SelectTrigger>
        </Select>
      </>,
    )
    for (const el of [screen.getByLabelText("Ort"), screen.getByLabelText("Meldung"), screen.getByLabelText("Einsatzart")]) {
      expect(el.className).toContain("px-(--field-px)")
      expect(el.className).not.toMatch(OWN_PX)
    }
  })

  it("the detail panel's dense skin uses the same inset", () => {
    expect(DENSE_CONTROL).toContain("px-(--field-px)")
    expect(DENSE_CONTROL).not.toMatch(OWN_PX)
  })

  it("SearchInput puts its icon at the inset and the text after it", () => {
    const { container } = renderWithIntl(<SearchInput aria-label="Suche" value="" onValueChange={() => {}} />)
    const icon = container.querySelector("svg") as SVGElement
    expect(icon.getAttribute("class")).toContain("left-[calc(var(--field-px)+1px)]")
    expect(screen.getByLabelText("Suche").className).toContain("pl-[calc(var(--field-px)+1.5rem)]")
  })

  it("one height token per form: Input/Select at --field-h, the dense skin at --field-h-dense", () => {
    render(
      <>
        <Input aria-label="Kontakt" />
        <Select>
          <SelectTrigger aria-label="Priorität">
            <SelectValue placeholder="Priorität" />
          </SelectTrigger>
        </Select>
      </>,
    )
    expect(screen.getByLabelText("Kontakt").className).toContain("h-(--field-h)")
    expect(screen.getByLabelText("Priorität").className).toContain("data-[size=default]:h-(--field-h)")
    // the dense skin pins the select's size variant too, or the select stays taller
    expect(DENSE_CONTROL).toContain("h-(--field-h-dense)")
    expect(DENSE_CONTROL).toContain("data-[size=default]:h-(--field-h-dense)")
  })
})

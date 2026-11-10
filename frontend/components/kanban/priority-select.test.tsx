import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { PrioritySelect } from "@/components/kanban/priority-select"
import { renderWithIntl } from "@/test-utils/render-with-intl"

describe("PrioritySelect", () => {
  it("draws the priority mark before the word, closed and open, and reports the picked priority", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderWithIntl(<PrioritySelect value="low" onValueChange={onValueChange} />)

    const trigger = screen.getByRole("combobox")
    expect(trigger).toHaveTextContent("Niedrig")
    expect(trigger.querySelector("[data-slot=priority-glyph]")).not.toBeNull()

    await user.click(trigger)
    const options = await screen.findAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual(["Niedrig", "Mittel", "Hoch"])
    for (const option of options) expect(option.querySelector("[data-slot=priority-glyph]")).not.toBeNull()

    await user.click(screen.getByRole("option", { name: "Hoch" }))
    expect(onValueChange).toHaveBeenCalledWith("high")
  })
})

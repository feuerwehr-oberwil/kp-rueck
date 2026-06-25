import { describe, it, expect } from "vitest"
import { renderMessageTemplate } from "./message-template"

describe("renderMessageTemplate", () => {
  it("replaces tokens with their values", () => {
    expect(renderMessageTemplate("Hallo {name}", { name: "Welt" })).toBe("Hallo Welt")
  })

  it("drops a line whose tokens all resolve empty (emoji and all)", () => {
    const out = renderMessageTemplate("🚒 {vehicles}\n👤 {crew}", {
      vehicles: "",
      crew: "Hans, Peter",
    })
    expect(out).toBe("👤 Hans, Peter")
  })

  it("keeps a line when at least one token has content", () => {
    const out = renderMessageTemplate("{a} und {b}", { a: "X", b: "" })
    expect(out).toBe("X und ")
  })

  it("always keeps token-less lines (static text, separators)", () => {
    const out = renderMessageTemplate("Kopf\n{empty}\nFuss", { empty: "" })
    expect(out).toBe("Kopf\nFuss")
  })

  it("collapses runs of blank lines and trims leading/trailing blanks", () => {
    const out = renderMessageTemplate("\n\nA\n\n\nB\n\n", { x: "" })
    expect(out).toBe("A\n\nB")
  })

  it("expands a multi-line block token into multiple lines", () => {
    const out = renderMessageTemplate("🧰 {materials}", {
      materials: "Material:\n- a\n- b",
    })
    expect(out).toBe("🧰 Material:\n- a\n- b")
  })

  it("collapses the separator when an in-between section drops out", () => {
    const template = "📍 {location}\n\n🚒 {vehicles}\n\n_Fuss_"
    // No vehicles → its line and one of the surrounding blanks collapse.
    expect(renderMessageTemplate(template, { location: "Basel", vehicles: "" })).toBe(
      "📍 Basel\n\n_Fuss_",
    )
  })
})

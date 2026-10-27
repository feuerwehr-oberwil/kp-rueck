import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PersonName, PersonNamingProvider } from "./person-name"

const roster = [
  { id: "p-1", name: "Meier Alex", kennung: "1985" },
  { id: "p-2", name: "Meier Alex", kennung: null },
  { id: "p-3", name: "Muster Hans", kennung: "412" },
]

function names(...ids: string[]) {
  return render(
    <PersonNamingProvider roster={roster}>
      {ids.map((id) => (
        <p key={id} data-testid={id}>
          <PersonName personnelId={id} name={roster.find((p) => p.id === id)!.name} />
        </p>
      ))}
    </PersonNamingProvider>,
  )
}

describe("PersonName", () => {
  it("follows a namesake with « · » and the Kennung in muted mono, «?» without one", () => {
    names("p-1", "p-2")
    expect(screen.getByTestId("p-1").textContent).toBe("Meier Alex · 1985")
    expect(screen.getByTestId("p-2").textContent).toBe("Meier Alex · ?")
    const kennung = screen.getByText("· 1985", { exact: false })
    expect(kennung).toHaveClass("font-mono", "text-muted-foreground", "shrink-0")
    // Too narrow for both: the name ellipsizes, the Kennung stays, the full label is the title.
    expect(screen.getAllByTitle("Meier Alex · 1985")[0]).toHaveClass("truncate")
  })

  it("draws a unique name as bare text, exactly as before", () => {
    names("p-3")
    expect(screen.getByTestId("p-3").innerHTML).toBe("Muster Hans")
  })
})

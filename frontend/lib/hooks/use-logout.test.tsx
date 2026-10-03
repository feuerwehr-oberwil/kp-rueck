import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"

const auth = vi.hoisted(() => ({
  user: { username: "editor", display_name: "Maja Berger", role: "editor" } as { username: string; display_name: string; role: string },
  isEditor: true,
  logout: vi.fn(async () => {}),
}))
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => auth }))
const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { useLogout } from "./use-logout"
import { AccountBlock } from "@/components/auth/account-block"

function Harness() {
  const { requestLogout, logoutDialog } = useLogout()
  return (
    <>
      <AccountBlock />
      <button onClick={requestLogout}>Abmelden</button>
      {logoutDialog}
    </>
  )
}
const renderIt = () =>
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <Harness />
    </NextIntlClientProvider>,
  )

describe("account block + logout", () => {
  it("names the person (display name, login name beside it) with the role", () => {
    renderIt()
    expect(screen.getByText("Maja Berger")).toBeInTheDocument()
    expect(screen.getByText("@editor")).toBeInTheDocument()
    expect(screen.getByText("Bearbeiter")).toBeInTheDocument()
    expect(screen.getByLabelText("Angemeldet als Maja Berger")).toBeInTheDocument()
  })

  it("«Abmelden» asks once, then logs out and lands on /login", async () => {
    renderIt()
    await userEvent.click(screen.getByRole("button", { name: "Abmelden" }))
    expect(screen.getByText("Abmelden?")).toBeInTheDocument()
    expect(auth.logout).not.toHaveBeenCalled()
    await userEvent.click(screen.getAllByRole("button", { name: "Abmelden" }).at(-1)!)
    expect(auth.logout).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith("/login")
  })
})

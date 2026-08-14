/**
 * The top navigation used to render a `<Button>` inside a `<Link>`: three
 * nested-interactive violations, anchors with no accessible name, two tab stops
 * per item — and the current page's anchor still navigated while the button it
 * wrapped was `disabled`. These tests pin the shape that replaced it.
 *
 * UserMenu and the notification bell are stubbed: they drag in auth, event and
 * notification contexts and are not what this component is being tested for.
 */

import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { vi } from "vitest"

import de from "@/messages/de.json"

vi.mock("@/components/user-menu", () => ({
  UserMenu: () => <button type="button">Benutzermenü öffnen</button>,
}))
vi.mock("@/components/notifications/notification-bell-trigger", () => ({
  NotificationBellTrigger: () => <button type="button">Benachrichtigungen</button>,
}))

import { PageNavigation } from "./page-navigation"

const renderNav = (props: Parameters<typeof PageNavigation>[0]) =>
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <PageNavigation {...props} />
    </NextIntlClientProvider>,
  )

const nav = () => screen.getByRole("navigation")

describe("PageNavigation", () => {
  it("gives the current page no link and marks it as the current page", () => {
    renderNav({ currentPage: "kanban" })

    // Nothing navigates back to the page we are already on.
    expect(within(nav()).queryByRole("link", { name: "Kanban Board" })).toBeNull()

    const current = within(nav()).getByRole("button", { name: "Kanban Board" })
    expect(current).toBeDisabled()
    expect(current).toHaveAttribute("aria-current", "page")

    // The other destinations stay reachable, as links.
    expect(within(nav()).getByRole("link", { name: "Lagekarte" })).toHaveAttribute("href", "/map")
    expect(within(nav()).getByRole("link", { name: "Ereignisse" })).toHaveAttribute("href", "/events")
  })

  it("names every control and never nests one inside another", () => {
    renderNav({ currentPage: "map" })

    const interactive = [...nav().querySelectorAll("a[href], button")]
    expect(interactive.length).toBeGreaterThan(0)
    for (const el of interactive) {
      expect(el.querySelector("a[href], button")).toBeNull()
      const name = el.getAttribute("aria-label") ?? el.textContent?.trim()
      expect(name).toBeTruthy()
    }
  })

  it("carries the open incident across to the other surface", () => {
    renderNav({ currentPage: "kanban", selectedIncidentId: "inc-7" })

    expect(within(nav()).getByRole("link", { name: "Lagekarte" })).toHaveAttribute(
      "href",
      "/map?highlight=inc-7",
    )
  })

  it("cannot be navigated with no event selected", () => {
    renderNav({ currentPage: "kanban", hasSelectedEvent: false })

    expect(within(nav()).queryByRole("link", { name: "Lagekarte" })).toBeNull()
    expect(within(nav()).getByRole("button", { name: "Lagekarte" })).toBeDisabled()
    // Picking an event has to stay reachable, or there is no way out.
    expect(within(nav()).getByRole("link", { name: "Ereignisse" })).toHaveAttribute("href", "/events")
  })
})

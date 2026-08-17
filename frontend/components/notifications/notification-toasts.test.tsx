/**
 * A «Meldung vom Feld» toast names a Schadenplatz. It has to lead there — and
 * only when there is somewhere to go: no incident on the notification, or no
 * page listening for the navigation, and the message stays plain text rather
 * than becoming a click target that does nothing.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { ReactNode } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"

import de from "@/messages/de.json"
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/types/notification"
import type { Notification } from "@/lib/types/notification"

const mocks = vi.hoisted(() => ({
  toastCalls: [] as Array<{ level: string; options: Record<string, unknown> }>,
  dismiss: vi.fn(),
  navigateToIncident: vi.fn(),
  dismissNotification: vi.fn(),
  notifications: [] as Notification[],
  canNavigateToIncident: true,
}))

vi.mock("sonner", () => {
  const record =
    (level: string) => (_title: unknown, options: Record<string, unknown> = {}) => {
      mocks.toastCalls.push({ level, options })
      return level
    }
  const toast = Object.assign(record("message"), {
    success: record("success"),
    info: record("info"),
    warning: record("warning"),
    error: record("error"),
    loading: record("loading"),
    message: record("message"),
    dismiss: mocks.dismiss,
  })
  return { toast, Toaster: () => null }
})

vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }))

vi.mock("@/lib/contexts/notification-context", () => ({
  useNotifications: () => ({
    notifications: mocks.notifications,
    dismissNotification: mocks.dismissNotification,
    isSidebarOpen: false,
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    openSidebar: vi.fn(),
    navigateToIncident: mocks.navigateToIncident,
    canNavigateToIncident: mocks.canNavigateToIncident,
  }),
}))

import { NotificationToasts } from "./notification-toasts"

const fieldMessage = (overrides: Partial<Notification> = {}): Notification => ({
  id: `n-${Math.random().toString(36).slice(2)}`,
  type: "field_message",
  severity: "info",
  message: "Meldung vom Feld (Muster) – Hauptstrasse 1: Baum liegt quer",
  incident_id: "incident-1",
  created_at: new Date("2026-08-17T10:00:00Z"),
  dismissed: false,
  ...overrides,
})

/** Mount the component and hand back the description of the single toast it fired. */
function toastDescription(notification: Notification): unknown {
  mocks.notifications = [notification]
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <NotificationToasts />
    </NextIntlClientProvider>,
  )
  expect(mocks.toastCalls).toHaveLength(1)
  return mocks.toastCalls[0].options.description
}

describe("NotificationToasts", () => {
  beforeEach(() => {
    mocks.toastCalls.length = 0
    mocks.canNavigateToIncident = true
    // Node 26 ships no localStorage unless started with --localstorage-file, and
    // the component remembers which toasts it already showed in there. A fresh
    // in-memory store per test keeps one test's toast from silencing the next.
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    })
  })

  it("opens the incident on the Rapport tab when the message is clicked", () => {
    const notification = fieldMessage()
    const description = toastDescription(notification)

    render(<>{description as ReactNode}</>)
    fireEvent.click(screen.getByRole("button", { name: notification.message }))

    expect(mocks.navigateToIncident).toHaveBeenCalledWith("incident-1", "rapport")
    // The toast goes with the click; its onDismiss clears the notification.
    expect(mocks.dismiss).toHaveBeenCalledWith(notification.id)
  })

  it("leaves the message as plain text when the notification carries no incident", () => {
    expect(toastDescription(fieldMessage({ incident_id: undefined }))).toBe(
      "Meldung vom Feld (Muster) – Hauptstrasse 1: Baum liegt quer",
    )
  })

  it("leaves the message as plain text when no page is listening for the navigation", () => {
    mocks.canNavigateToIncident = false
    expect(typeof toastDescription(fieldMessage())).toBe("string")
  })
})

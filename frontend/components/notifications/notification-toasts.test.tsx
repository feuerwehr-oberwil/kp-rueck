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
import { loadMessages, type SupportedLocale } from "@/lib/i18n-messages"
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/types/notification"
import type { Notification } from "@/lib/types/notification"

const mocks = vi.hoisted(() => ({
  toastCalls: [] as Array<{ level: string; title: unknown; options: Record<string, unknown> }>,
  dismiss: vi.fn(),
  navigateToIncident: vi.fn(),
  dismissNotification: vi.fn(),
  notifications: [] as Notification[],
  operations: [] as Array<{ id: string; status: string; assignedReko?: { id: string; name: string } | null }>,
  canNavigateToIncident: true,
}))

vi.mock("sonner", () => {
  const record =
    (level: string) => (title: unknown, options: Record<string, unknown> = {}) => {
      mocks.toastCalls.push({ level, title, options })
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
  return { toast }
})
// the lane itself (look, placement) has its own test — components/ui/sonner.test.tsx
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }))

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

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ operations: mocks.operations }),
}))

import { NotificationToasts } from "./notification-toasts"

const fieldMessage = (overrides: Partial<Notification> = {}): Notification => ({
  id: `n-${Math.random().toString(36).slice(2)}`,
  type: "field_message",
  severity: "info",
  message: "Meldung vom Feld (Muster) – Hauptstrasse 1: Baum liegt quer",
  params: { place: "Hauptstrasse 1", text: "Baum liegt quer", actor_kind: "field", actor_name: "Muster" },
  incident_id: "incident-1",
  created_at: new Date("2026-08-17T10:00:00Z"),
  dismissed: false,
  ...overrides,
})

/** Mount the component and hand back the single toast it fired. */
function firedToast(notification: Notification, locale: SupportedLocale = "de") {
  mocks.notifications = [notification]
  render(
    <NextIntlClientProvider locale={locale} messages={loadMessages(locale)}>
      <NotificationToasts />
    </NextIntlClientProvider>,
  )
  expect(mocks.toastCalls).toHaveLength(1)
  return mocks.toastCalls[0]
}

describe("NotificationToasts", () => {
  beforeEach(() => {
    mocks.toastCalls.length = 0
    mocks.canNavigateToIncident = true
    mocks.operations = []
    mocks.dismissNotification.mockClear()
    mocks.dismiss.mockClear()
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

  it("opens the incident on the Rapport tab from anywhere on the toast", () => {
    const notification = fieldMessage()
    const fired = firedToast(notification)

    render(<>{fired.title as ReactNode}</>)
    // the source is said to screen readers, the text is what is asked
    const open = screen.getByRole("button", { name: "Meldung vom Feld: Baum liegt quer" })
    // no dotted underline any more — the whole toast is the target (stretched ::after)
    expect(open.className).not.toMatch(/underline/)
    expect(open.className).toMatch(/after:absolute after:inset-0/)
    fireEvent.click(open)

    expect(mocks.navigateToIncident).toHaveBeenCalledWith("incident-1", "rapport")
    // The toast goes with the click; its onDismiss clears the notification.
    expect(mocks.dismiss).toHaveBeenCalledWith(notification.id)
  })

  it("reads what is asked first, then where · who, with the field glyph", () => {
    const fired = firedToast(fieldMessage({ incident_id: undefined }))
    render(<>{fired.title as ReactNode}</>)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("Baum liegt quer")).toBeInTheDocument()
    expect(fired.options.description).toBe("Hauptstrasse 1 · Muster")
    expect(fired.options.icon).toBeTruthy()
    // no fixed duration: the lifetime comes from the length (lib/toast-lifetime.ts)
    expect(fired.options.duration).toBeUndefined()
  })

  it("says it in the operator's language: French frame, the crew's own words", () => {
    const fired = firedToast(
      fieldMessage({
        type: "field_pickup",
        severity: "warning",
        incident_id: undefined,
        params: { place: "Hauptstrasse 1", needed: true, note: null, actor_kind: "kp", actor_name: null },
      }),
      "fr",
    )
    render(<>{fired.title as ReactNode}</>)
    expect(screen.getByText("Récupération nécessaire")).toBeInTheDocument()
    expect(fired.options.description).toBe("Hauptstrasse 1 · saisi au PC")
  })

  it("stays plain text when no page is listening for the navigation", () => {
    mocks.canNavigateToIncident = false
    const fired = firedToast(fieldMessage())
    render(<>{fired.title as ReactNode}</>)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("keeps the warning tone and leaves a system notification one line, glyph by severity", () => {
    const fired = firedToast(
      // a row from before `params`: its German sentence, whole
      fieldMessage({ type: "no_personnel", severity: "warning", incident_id: undefined, message: "Kein Personal mehr verfügbar", params: null }),
    )
    expect(fired.level).toBe("warning")
    render(<>{fired.title as ReactNode}</>)
    expect(screen.getByText("Kein Personal mehr verfügbar")).toBeInTheDocument()
    expect(fired.options.description).toBeUndefined()
    expect(fired.options.icon).toBeUndefined()
  })

  it("keeps a critical one red and up until its ✕, in the same two lines", () => {
    const fired = firedToast(
      fieldMessage({
        type: "training_emergency" as Notification["type"],
        severity: "critical",
        incident_id: undefined,
        message: "Lage verschärft: Wasser im Keller – Wasser steigt",
        params: { variant: "escalation", title: "Wasser im Keller", text: "Wasser steigt" },
      }),
    )
    expect(fired.level).toBe("error")
    expect(fired.options.duration).toBe(Infinity)
    expect(fired.options.action).toBeUndefined()
    expect(fired.options.description).toBe("Wasser im Keller")
    render(<>{fired.title as ReactNode}</>)
    expect(screen.getByText("Kritisch · Übung:", { exact: false })).toBeInTheDocument()
    expect(screen.getByText("Lage verschärft – Wasser steigt")).toBeInTheDocument()
  })

  it("silences a new-emergency notification once the board has overtaken it", () => {
    const notification = fieldMessage({ type: "field_report" })
    mocks.notifications = [notification]
    mocks.operations = [{ id: "incident-1", status: "enroute" }]

    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <NotificationToasts />
      </NextIntlClientProvider>,
    )

    expect(mocks.dismissNotification).toHaveBeenCalledWith(notification.id)
    expect(mocks.dismiss).toHaveBeenCalledWith(notification.id)
  })

  it("leaves a new-emergency notification alone while its incident still waits", () => {
    const notification = fieldMessage({ type: "field_report" })
    mocks.notifications = [notification]
    mocks.operations = [{ id: "incident-1", status: "incoming" }]

    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <NotificationToasts />
      </NextIntlClientProvider>,
    )

    expect(mocks.dismissNotification).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"

import { renderWithIntl } from "@/test-utils/render-with-intl"
import {
  noteFieldEdit,
  noteFieldSend,
  noteFieldSettled,
  resetFieldSaveForTests,
  setFieldSaveScope,
} from "@/lib/field-save"

const copyToClipboard = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  copyToClipboard,
}))

import { FieldSaveStatus, SAVED_LINE_MS, useFieldSave, useUnsavedDraftLeaveGuard } from "./field-save-status"

function Closable({ onClose }: { onClose: () => void }) {
  const { guard, dialog } = useUnsavedDraftLeaveGuard("inc-1")
  return (
    <div>
      {dialog}
      <button type="button" onClick={() => guard(onClose)}>
        Schliessen
      </button>
    </div>
  )
}

/** A field the way the detail wires one: value from the hook, line under it. */
function Field({ server, onRetry = () => {} }: { server: string; onRetry?: (draft: string) => void }) {
  const view = useFieldSave("inc-1", "notes", server)
  return (
    <div>
      <textarea aria-label="Meldung" value={view.value} aria-invalid={view.failed || undefined} readOnly />
      <FieldSaveStatus view={view} onRetry={onRetry} />
    </div>
  )
}

/** A toggle note: the state as a mark inside the field, only a failure below it. */
function NoteField({ server }: { server: string }) {
  const view = useFieldSave("inc-1", "notes", server)
  return (
    <div>
      <div data-testid="row">
        <input aria-label="Notiz" value={view.value} readOnly />
        <FieldSaveStatus part="mark" view={view} onRetry={() => {}} />
      </div>
      <div data-testid="below">
        <FieldSaveStatus part="failure" view={view} onRetry={() => {}} />
      </div>
    </div>
  )
}

beforeEach(() => {
  resetFieldSaveForTests()
  setFieldSaveScope("user-a:event-1")
  copyToClipboard.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

function edit(value: string, server = "Keller") {
  act(() => noteFieldEdit("inc-1", "notes", value, server))
}

describe("FieldSaveStatus", () => {
  it("part=mark keeps saving/saved inside the row and opens the line below only on failure", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    vi.setSystemTime(new Date(2026, 9, 2, 9, 41, 0))
    renderWithIntl(<NoteField server="" />)
    const row = screen.getByTestId("row")
    const below = screen.getByTestId("below")

    edit("FW Therwil", "")
    expect(row.querySelector("[role=status]")).toHaveAttribute("title", "Wird gespeichert …")
    expect(below).toBeEmptyDOMElement()

    let ticket!: ReturnType<typeof noteFieldSend>
    act(() => {
      ticket = noteFieldSend("inc-1", ["notes"])
    })
    act(() => noteFieldSettled(ticket, { ok: true }))
    expect(row.querySelector("[role=status]")).toHaveAttribute("title", "Gespeichert – 09:41")
    expect(below).toBeEmptyDOMElement()

    edit("FW Therwil, Kdt.", "FW Therwil")
    act(() => {
      ticket = noteFieldSend("inc-1", ["notes"])
    })
    act(() => noteFieldSettled(ticket, { ok: false, reason: "network" }))
    expect(within(below).getByRole("button", { name: "Erneut speichern" })).toBeInTheDocument()
    expect(row.querySelector("[title='Nicht gespeichert.']")).not.toBeNull()
  })

  it("is quiet until something is edited", () => {
    const { container } = renderWithIntl(<Field server="Keller" />)
    expect(container.querySelector("[role=status]")).toBeNull()
    expect(screen.getByLabelText("Meldung")).toHaveValue("Keller")
  })

  it("pending → saving → saved, and the saved line goes quiet again", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    vi.setSystemTime(new Date(2026, 9, 2, 9, 41, 0))
    renderWithIntl(<Field server="Keller" />)

    edit("Keller, 40 cm")
    expect(screen.getByRole("status")).toHaveTextContent("Wird gespeichert …")

    let ticket!: ReturnType<typeof noteFieldSend>
    act(() => {
      ticket = noteFieldSend("inc-1", ["notes"])
    })
    expect(screen.getByRole("status")).toHaveTextContent("Wird gespeichert …")

    act(() => noteFieldSettled(ticket, { ok: true }))
    expect(screen.getByRole("status")).toHaveTextContent("Gespeichert – 09:41")

    act(() => {
      vi.advanceTimersByTime(SAVED_LINE_MS + 10)
    })
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("a failure keeps the text in the field, marks it, and offers retry and copy", async () => {
    const onRetry = vi.fn()
    renderWithIntl(<Field server="Keller" onRetry={onRetry} />)

    edit("Keller, Pumpe läuft")
    let ticket!: ReturnType<typeof noteFieldSend>
    act(() => {
      ticket = noteFieldSend("inc-1", ["notes"])
    })
    act(() => noteFieldSettled(ticket, { ok: false, reason: "network" }))

    const field = screen.getByLabelText("Meldung")
    expect(field).toHaveValue("Keller, Pumpe läuft")
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Nicht gespeichert. Keine Verbindung zum Server – der Text bleibt hier stehen.",
    )
    expect(screen.queryByText(/Gespeichert –/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Erneut speichern" }))
    expect(onRetry).toHaveBeenCalledWith("Keller, Pumpe läuft")

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Text kopieren" }))
    })
    expect(copyToClipboard).toHaveBeenCalledWith("Keller, Pumpe läuft")
    expect(screen.getByRole("button", { name: "Kopiert" })).toBeInTheDocument()
  })

  it("a newer value from the server does not replace the kept draft — it is named next to it", () => {
    const { rerender } = renderWithIntl(<Field server="Keller" />)
    edit("Keller, Pumpe läuft")
    let ticket!: ReturnType<typeof noteFieldSend>
    act(() => {
      ticket = noteFieldSend("inc-1", ["notes"])
    })
    act(() => noteFieldSettled(ticket, { ok: false, reason: "conflict" }))

    // A reload brings somebody else's text.
    rerender(<Field server="Keller, Nachtrag KP" />)
    expect(screen.getByLabelText("Meldung")).toHaveValue("Keller, Pumpe läuft")
    expect(screen.getByText("Auf dem Server steht inzwischen: «Keller, Nachtrag KP»")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Der Einsatz wurde inzwischen anderswo geändert")
  })

  it("a user switch takes the draft away — the field shows the board again", () => {
    renderWithIntl(<Field server="Keller" />)
    edit("Text von A")
    let ticket!: ReturnType<typeof noteFieldSend>
    act(() => {
      ticket = noteFieldSend("inc-1", ["notes"])
    })
    act(() => noteFieldSettled(ticket, { ok: false, reason: "network" }))
    expect(screen.getByLabelText("Meldung")).toHaveValue("Text von A")

    act(() => setFieldSaveScope("user-b:event-1"))
    expect(screen.getByLabelText("Meldung")).toHaveValue("Keller")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  describe("leaving the Einsatz", () => {
    it("closes at once when nothing is unsaved — pending text is on its way", () => {
      const onClose = vi.fn()
      renderWithIntl(<Closable onClose={onClose} />)
      edit("unterwegs")
      fireEvent.click(screen.getByRole("button", { name: "Schliessen" }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("asks first when a text did not reach the server, and names the field", () => {
      const onClose = vi.fn()
      renderWithIntl(<Closable onClose={onClose} />)
      edit("Pumpe läuft")
      let ticket!: ReturnType<typeof noteFieldSend>
      act(() => {
        ticket = noteFieldSend("inc-1", ["notes"])
      })
      act(() => noteFieldSettled(ticket, { ok: false, reason: "network" }))

      fireEvent.click(screen.getByRole("button", { name: "Schliessen" }))
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole("alertdialog")).toHaveTextContent("«Meldung» konnte nicht gespeichert werden.")

      fireEvent.click(screen.getByRole("button", { name: "Trotzdem schliessen" }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})

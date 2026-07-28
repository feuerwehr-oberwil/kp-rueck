import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Popover, PopoverContent } from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

/** A sonner toast and the «Alle ausblenden» pill, as they sit in the DOM. */
function ToastLayer() {
  return (
    <>
      <ol data-sonner-toaster="">
        <li data-sonner-toast="">
          <button type="button">Schliessen</button>
        </li>
      </ol>
      <button type="button" data-toast-layer="">
        Alle ausblenden
      </button>
    </>
  )
}

/** Non-modal: a modal dialog already makes everything behind it inert, so the
 *  toast is not clickable there in the first place. This is the reachable case. */
function OpenDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return (
    <>
      <Dialog modal={false} open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Funkdurchsage</DialogTitle>
        </DialogContent>
      </Dialog>
      <ToastLayer />
      <button type="button">Irgendwo daneben</button>
    </>
  )
}

function OpenSheet({
  onOpenChange,
  onInteractOutside,
}: {
  onOpenChange: (open: boolean) => void
  onInteractOutside?: () => void
}) {
  return (
    <>
      <Sheet modal={false} open onOpenChange={onOpenChange}>
        <SheetContent nonModal onInteractOutside={onInteractOutside}>
          <SheetTitle>Aufträge</SheetTitle>
        </SheetContent>
      </Sheet>
      <ToastLayer />
      <button type="button">Irgendwo daneben</button>
    </>
  )
}

function OpenPopover({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return (
    <>
      <Popover open onOpenChange={onOpenChange}>
        <PopoverContent>Farbe wählen</PopoverContent>
      </Popover>
      <ToastLayer />
      <button type="button">Irgendwo daneben</button>
    </>
  )
}

function OpenDropdown({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return (
    <>
      {/* Non-modal for the same reason as the dialog above. */}
      <DropdownMenu modal={false} open onOpenChange={onOpenChange}>
        <DropdownMenuContent>
          <DropdownMenuItem>Umbenennen</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToastLayer />
      <button type="button">Irgendwo daneben</button>
    </>
  )
}

describe("dismissing a toast never dismisses the panel behind it", () => {
  it("keeps a dialog open when a toast is closed", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<OpenDialog onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole("button", { name: "Schliessen" }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("keeps a dialog open when the dismiss-all pill is used", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<OpenDialog onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole("button", { name: "Alle ausblenden" }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("keeps a slide-up open when a toast is closed, and leaves its own guard alone", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onInteractOutside = vi.fn()
    render(<OpenSheet onOpenChange={onOpenChange} onInteractOutside={onInteractOutside} />)

    await user.click(screen.getByRole("button", { name: "Schliessen" }))
    expect(onOpenChange).not.toHaveBeenCalled()
    // The caller's guard is for real outside clicks — a toast never reaches it.
    expect(onInteractOutside).not.toHaveBeenCalled()

    // Control: a genuine outside click still closes, and still runs the guard.
    await user.click(screen.getByRole("button", { name: "Irgendwo daneben" }))
    expect(onInteractOutside).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("keeps a popover open when a toast is closed", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<OpenPopover onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole("button", { name: "Schliessen" }))
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Irgendwo daneben" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("keeps a dropdown menu open when a toast is closed", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<OpenDropdown onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole("button", { name: "Schliessen" }))
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Irgendwo daneben" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog'
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes-warning'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const content = () => document.querySelector<HTMLElement>('[data-slot="sheet-content"]')

/** One finger from `y0` down to `y1` in steps (jsdom: plain objects stand in for Touch). */
function pull(el: Element, y0: number, y1: number, steps = 6) {
  const at = (y: number) => [{ identifier: 1, clientX: 100, clientY: y }]
  fireEvent.touchStart(el, { touches: at(y0), changedTouches: at(y0) })
  for (let i = 1; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps
    fireEvent.touchMove(el, { touches: at(y), changedTouches: at(y) })
  }
  fireEvent.touchEnd(el, { touches: [], changedTouches: at(y1) })
}

function BottomSheet({
  onOpenChange,
  children,
  ...props
}: {
  onOpenChange: (open: boolean) => void
  children?: React.ReactNode
  overlayOffset?: string
  nonModal?: boolean
  swipeToClose?: boolean
}) {
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="bottom" aria-describedby={undefined} {...props}>
        <SheetHeader>
          <SheetTitle>Weitere Funktionen</SheetTitle>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  )
}

describe('bottom Sheet swipe-to-dismiss', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('style')
  })

  it('draws a grip and closes on a long pull from the header', () => {
    const onOpenChange = vi.fn()
    render(<BottomSheet onOpenChange={onOpenChange} />)
    expect(document.querySelector('[data-slot="sheet-grip"]')).not.toBeNull()
    pull(screen.getByText('Weitere Funktionen'), 100, 300)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('snaps back after a short pull', () => {
    const onOpenChange = vi.fn()
    render(<BottomSheet onOpenChange={onOpenChange} />)
    pull(screen.getByText('Weitere Funktionen'), 100, 130)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('leaves a pull on scrolled content to the scroller', () => {
    const onOpenChange = vi.fn()
    render(
      <BottomSheet onOpenChange={onOpenChange}>
        <div data-testid="list" style={{ overflowY: 'auto' }}>
          <p>Zeile</p>
        </div>
      </BottomSheet>,
    )
    const list = screen.getByTestId('list')
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 300 })
    list.scrollTop = 120
    pull(screen.getByText('Zeile'), 100, 400)
    expect(onOpenChange).not.toHaveBeenCalled()

    // …and at the very top the same pull closes
    list.scrollTop = 0
    pull(screen.getByText('Zeile'), 100, 400)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('never drags from a control', () => {
    const onOpenChange = vi.fn()
    render(
      <BottomSheet onOpenChange={onOpenChange}>
        <button type="button">Fahrzeuge</button>
      </BottomSheet>,
    )
    pull(screen.getByRole('button', { name: 'Fahrzeuge' }), 100, 400)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('has no grip and no swipe on a docked desktop footer sheet', () => {
    const onOpenChange = vi.fn()
    render(<BottomSheet onOpenChange={onOpenChange} overlayOffset="42px" nonModal />)
    expect(document.querySelector('[data-slot="sheet-grip"]')).toBeNull()
    pull(screen.getByText('Weitere Funktionen'), 100, 400)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('leaves an undocked bottom sheet\'s geometry to the keyboard rule (no inline bottom)', () => {
    // globals.css moves it into the visible band while a keyboard is up; an inline `bottom`
    // would beat that rule
    render(<BottomSheet onOpenChange={() => {}} />)
    expect(content()!.style.bottom).toBe('')
    expect(content()).not.toHaveAttribute('data-docked')
  })

  it('does not focus a field when a phone sheet opens (no keyboard until a tap)', () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetTitle>Neuer Einsatz</SheetTitle>
          <input aria-label="Einsatzort" />
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByLabelText('Einsatzort')).not.toHaveFocus()
    expect(content()).toHaveFocus()
  })

  it('still focuses the first field of a side sheet', () => {
    render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent side="right" aria-describedby={undefined}>
          <SheetTitle>Filter</SheetTitle>
          <input aria-label="Suche" />
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByLabelText('Suche')).toHaveFocus()
  })

  it('asks instead of closing when the form guards its onOpenChange (dirty)', async () => {
    function GuardedForm() {
      const [open, setOpen] = useState(true)
      const [text, setText] = useState('')
      const guard = useUnsavedChangesWarning({ isDirty: text !== '', isOpen: open, onClose: () => setOpen(false) })
      return (
        <>
          <Sheet open={open} onOpenChange={guard.handleOpenChange}>
            <SheetContent side="bottom" aria-describedby={undefined}>
              <SheetHeader>
                <SheetTitle>Meldung</SheetTitle>
              </SheetHeader>
              <input aria-label="Text" value={text} onChange={(e) => setText(e.target.value)} />
            </SheetContent>
          </Sheet>
          <UnsavedChangesDialog {...guard.dialogProps} />
        </>
      )
    }
    renderWithIntl(<GuardedForm />)
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Keller unter Wasser' } })
    pull(screen.getByText('Meldung'), 100, 400)
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Meldung')).toBeInTheDocument()
  })

  it('publishes --sheet-top while open and 0 once closed', () => {
    const { rerender } = render(
      <Sheet open onOpenChange={() => {}}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetTitle>Fahrzeuge</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    // jsdom has no layout: the top edge reads 0, i.e. the whole viewport height
    expect(document.documentElement.style.getPropertyValue('--sheet-top')).toBe(`${window.innerHeight}px`)
    rerender(
      <Sheet open={false} onOpenChange={() => {}}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetTitle>Fahrzeuge</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    expect(document.documentElement.style.getPropertyValue('--sheet-top')).toBe('0px')
  })
})

describe('bottom Sheet Escape', () => {
  it('closes an inner popover first, the sheet with the next Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <BottomSheet onOpenChange={onOpenChange}>
        <Popover>
          <PopoverTrigger>Einsatzart</PopoverTrigger>
          <PopoverContent>Elementarereignis</PopoverContent>
        </Popover>
      </BottomSheet>,
    )
    await user.click(screen.getByRole('button', { name: 'Einsatzart' }))
    expect(screen.getByText('Elementarereignis')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByText('Elementarereignis')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    await act(async () => {})
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

"use client"

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useIsMobile } from "@/components/ui/use-mobile"

/**
 * Live height of the page's footer toolbar, as a CSS length for
 * `overlayOffset`. The footer's height depends on its content and padding
 * (and can change with viewport width), so a hard-coded offset lets docked
 * sheets slide underneath it and clip — measure instead.
 */
export function useFooterOffset(active: boolean): string {
  const [offset, setOffset] = useState("42px")
  useEffect(() => {
    if (!active) return
    const measure = () => {
      const footer = document.querySelector("footer")
      if (footer) setOffset(`${Math.ceil(footer.getBoundingClientRect().height)}px`)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [active])
  return offset
}

interface FooterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  className?: string
  style?: CSSProperties
  /**
   * Desktop-only extra guard: return true to KEEP the sheet open when an
   * outside interaction targets `target` (e.g. a nested dialog is open). The
   * footer toolbar is always guarded — this is for additional cases.
   */
  shouldPreventClose?: (target: HTMLElement) => boolean
}

/**
 * A bottom-docked "footer sheet" — the command post's secondary panels
 * (Fahrzeugstatus, Druckoptionen, QR-Freigaben) that dock above the footer
 * toolbar on desktop but become normal modal bottom-sheets on mobile.
 *
 * Encapsulates the mobile/desktop branching that had been retyped in every
 * footer sheet: on desktop it's a non-modal sheet offset by the measured
 * footer height with no close button, and clicks on the footer toolbar don't dismiss
 * it; on mobile it's a plain modal sheet. Pass `shouldPreventClose` for the
 * one-off "a nested dialog is open" cases.
 */
export function FooterSheet({ open, onOpenChange, children, className, style, shouldPreventClose }: FooterSheetProps) {
  const isMobile = useIsMobile()
  const footerOffset = useFooterOffset(open && !isMobile)

  /**
   * The click that closes the sheet must not also hit the board.
   *
   * A desktop footer sheet is deliberately NON-modal — the footer toolbar stays
   * usable and the board stays legible behind it — but non-modal also means
   * nothing absorbs the pointer, so the click that dismissed the sheet went
   * straight on to open whatever kanban card was underneath. One click, two
   * actions, and the second one was never asked for.
   *
   * It also does the closing. A non-modal Radix dialog leaves the page fully
   * live — the outside pointerdown was reaching the board and dismissing
   * nothing, so a click on a card opened the card AND left the sheet standing.
   * Now the same click closes the sheet and stops there.
   *
   * The listener lives for the component's whole life rather than only while
   * `open`: the closing happens on `pointerdown`, the `click` follows
   * afterwards, and an `open`-scoped listener would already be gone by then.
   */
  const swallowNextClick = useRef(false)
  const guard = useRef({ open, isMobile, shouldPreventClose, onOpenChange })
  guard.current = { open, isMobile, shouldPreventClose, onOpenChange }

  useEffect(() => {
    const isOutside = (target: HTMLElement | null) => {
      const { open: isOpen, isMobile: onPhone, shouldPreventClose: prevent } = guard.current
      if (!isOpen || onPhone || !target) return false
      if (target.closest('[data-slot="sheet-content"]')) return false
      // The footer toolbar keeps working while a sheet is docked above it —
      // that is the whole point of the non-modal shape.
      if (target.closest("footer") || prevent?.(target)) return false
      return true
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!isOutside(event.target as HTMLElement | null)) return
      swallowNextClick.current = true
      guard.current.onOpenChange(false)
    }
    const onClick = (event: MouseEvent) => {
      if (!swallowNextClick.current) return
      swallowNextClick.current = false
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("click", onClick, true)
    }
  }, [])

  return (
    <Sheet modal={isMobile} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton={!isMobile}
        overlayOffset={isMobile ? undefined : footerOffset}
        nonModal={!isMobile}
        className={className}
        style={style}
        onInteractOutside={
          isMobile
            ? undefined
            : (e) => {
                const target = e.target as HTMLElement
                if (target.closest("footer") || shouldPreventClose?.(target)) {
                  e.preventDefault()
                }
              }
        }
      >
        {children}
      </SheetContent>
    </Sheet>
  )
}

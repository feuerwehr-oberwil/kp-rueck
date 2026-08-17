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

/**
 * Marks portalled content that belongs to an open footer sheet.
 *
 * Same problem `lib/toast-layer.ts` solves for toasts: a suggestion list or a
 * picker rendered by something *inside* the sheet lands at the end of `<body>`,
 * so every "did that click land outside?" test says yes and the sheet dismisses
 * itself — taking the half-filled form with it. Put this on the portalled
 * content and the sheet counts it as its own.
 *
 * Only needed for NON-modal layers. A modal one (a Radix dialog) locks the
 * body's pointer events, which the sheet already reads as "not mine" — see
 * `isAboveModalLayer`.
 */
export const SHEET_LAYER_ATTR = "data-sheet-layer"

/**
 * Is a modal layer stacked above us right now?
 *
 * Radix sets `pointer-events: none` on `<body>` for the duration of a modal
 * layer and uses that same flag internally to stop the layers underneath
 * reacting to outside interactions. The footer sheet's own document listener
 * (below) is hand-rolled, so it has to make the same check itself — otherwise
 * dropping a pin on the map picker, or clicking its backdrop, closes the sheet
 * the picker was opened from.
 */
function isAboveModalLayer(): boolean {
  return document.body.style.pointerEvents === "none"
}

/**
 * Everything a click can land on without meaning "dismiss the sheet": the
 * panel itself, the footer toolbar it docks above (which stays live — that is
 * the whole point of the non-modal shape), and any portalled layer tagged as
 * belonging to it.
 *
 * `Element`, not `HTMLElement`: the icons inside a suggestion row are `<svg>`
 * nodes. Both support `closest`, so this still walks up to the container.
 */
function isOwnLayer(target: Element): boolean {
  return Boolean(
    target.closest('[data-slot="sheet-content"]') ||
      target.closest(`[${SHEET_LAYER_ATTR}]`) ||
      target.closest("footer"),
  )
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
      if (isOwnLayer(target) || isAboveModalLayer()) return false
      if (prevent?.(target)) return false
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
                if (isOwnLayer(target) || isAboveModalLayer() || shouldPreventClose?.(target)) {
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

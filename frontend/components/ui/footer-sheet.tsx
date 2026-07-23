"use client"

import { type CSSProperties, type ReactNode } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useIsMobile } from "@/components/ui/use-mobile"

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
 * footer sheet: on desktop it's a non-modal sheet offset by the 42px footer
 * height with no close button, and clicks on the footer toolbar don't dismiss
 * it; on mobile it's a plain modal sheet. Pass `shouldPreventClose` for the
 * one-off "a nested dialog is open" cases.
 */
export function FooterSheet({ open, onOpenChange, children, className, style, shouldPreventClose }: FooterSheetProps) {
  const isMobile = useIsMobile()
  return (
    <Sheet modal={isMobile} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton={!isMobile}
        overlayOffset={isMobile ? undefined : "42px"}
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

import { cn } from "@/lib/utils"

/**
 * The CSS-only end fade of a plain `overflow-y` scroller: put it as the scroller's LAST child.
 * While content waits below, the bottom 24px fade into the surface – the same ramp as
 * `ScrollArea fadeEnd` (hill climb r6/r8), which measures with JS because Radix owns its
 * viewport. Here it is `sticky bottom-0`, so with more below it rides on the scroller's bottom
 * edge over the content; at the end it settles into its own 24px after the content, over
 * nothing – so the scroller needs no bottom padding of its own.
 *
 * Used by the detail tabs (r18) and the resource sidebars (r19). `surface` names what the
 * scroller sits on, because the ramp must end in exactly that colour:
 * - `dialog` – `--background` (the detail modal);
 * - `panel` – the `bg-card/30` panels over the board's background (side panel, Personen- and
 *   Material-Leiste), mixed here because a translucent stop would let the rows through.
 */
export function ScrollEndFade({
  surface,
  className,
}: {
  surface: "dialog" | "panel"
  className?: string
}) {
  return (
    <div
      aria-hidden
      data-slot="scroll-end-fade"
      className={cn(
        "pointer-events-none sticky bottom-0 h-6 shrink-0 bg-linear-to-t to-transparent",
        surface === "dialog" ? "from-background" : "from-[color-mix(in_oklab,var(--card)_30%,var(--background))]",
        className,
      )}
    />
  )
}

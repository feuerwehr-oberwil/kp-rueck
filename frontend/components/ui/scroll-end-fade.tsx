import { cn } from "@/lib/utils"

/**
 * The CSS-only end fade of a plain `overflow-y` scroller: put it as the scroller's LAST child.
 * While content waits below, the bottom 24px fade into the surface – the same ramp as
 * `ScrollArea fadeEnd` (hill climb r6/r8), which measures with JS because Radix owns its
 * viewport. Here it is `sticky bottom-0`, so with more below it rides on the scroller's bottom
 * edge over the content; at the end it settles into its own 24px after the content, over
 * nothing – so the scroller needs no bottom padding of its own.
 *
 * Used by the detail tabs (r18), the resource sidebars (r19) and the board columns (r21).
 * `surface` names what the scroller sits on, because the ramp must end in exactly that colour:
 * - `dialog` – `--background` (the detail modal);
 * - `panel` – the `bg-card/30` panels over the board's background (side panel, Personen- and
 *   Material-Leiste), mixed here because a translucent stop would let the rows through;
 * - `board` – the board itself (`#kanban-main`: `bg-muted/30` over the page's background in
 *   light, the bare background in dark); mixed in sRGB, which is how the browser lays a
 *   translucent fill over its backdrop, so the ramp's end meets the board exactly.
 */
export function ScrollEndFade({
  surface,
  className,
}: {
  surface: "dialog" | "panel" | "board"
  className?: string
}) {
  return (
    <div
      aria-hidden
      data-slot="scroll-end-fade"
      className={cn(
        "pointer-events-none sticky bottom-0 h-6 shrink-0 bg-linear-to-t to-transparent",
        surface === "dialog" && "from-background",
        surface === "panel" && "from-[color-mix(in_oklab,var(--card)_30%,var(--background))]",
        surface === "board" && "from-[color-mix(in_srgb,var(--muted)_30%,var(--background))] dark:from-background",
        className,
      )}
    />
  )
}

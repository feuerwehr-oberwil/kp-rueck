import { cn } from "@/lib/utils"

/**
 * One treatment for «dieses Ereignis ist eine Übung», shared by every surface
 * that names an Ereignis — the board header and its switcher, the wall, the Karte,
 * the phone, /feld, /alarm, the Alarmeingang, the Ereignisse list, the audit filter.
 * An Ereignis is a drill or the real thing *as a whole*, so the mode belongs on
 * the frame and beside the name; single cards, list rows and map pins carry no
 * training marker.
 *
 * The look is KP Front's ÜBUNG tag (`.ip-badge-exercise`, owner 17.11.2026, ENT-09):
 * HATCHED, outlined, no hue, ink text (`training-hatch` in app/globals.css). No
 * colour, so a drill is never mistaken for a real Einsatz and never for «schau
 * hin» – it was amber, the colour of Mittel and «kein Rapport».
 *
 * `TrainingBand` is the hatched ink strip along the top edge (ENT-09b A, 5px so the
 * stripes read). It is chrome, not content, so it never competes with the priority
 * colours inside the board — and it is deliberately never animated and never
 * dismissible: a two-hour drill would train away anything that blinks or can be
 * clicked shut.
 *
 * It is FIXED to the top of the viewport and takes NO layout height. In flow it
 * only pushed down the siblings of whichever surface rendered it: with the
 * Benachrichtigungen sidebar open, the board header sat below the sidebar
 * header beside it, because that panel is a flex sibling of <main> and never saw
 * the strip. Out of flow there is nothing to push out of alignment, at any
 * viewport width, and the strip lies over sidebars and overlays instead of
 * beside them. `z-training-band` is above every panel and dialog but below the 2px
 * top-loading bar (`z-loading-bar`), which would otherwise be invisible underneath it.
 */
export function TrainingBand({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-x-0 top-0 z-training-band h-[5px] bg-background training-hatch-band", className)}
    />
  )
}

/**
 * The ÜBUNG tag beside an Ereignis name. The word carries the meaning (uppercase by
 * CSS, so the catalogue keeps «Übung»); the label comes from the caller because every
 * surface already holds that string in its own message namespace.
 *
 * `square` is the «Ü» tag for a row where the word does not fit (a select item, a
 * dense menu row, the phone's event line) – Front's phone square. The letter is the
 * label's first, so «Exercice» reads «E»; the full word is its accessible name.
 */
export function TrainingBadge({
  label,
  square = false,
  className,
}: {
  label: string
  square?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "training-hatch inline-flex shrink-0 items-center justify-center rounded text-2xs font-bold uppercase tracking-[0.03em] whitespace-nowrap text-foreground",
        square ? "size-5" : "px-1.5 py-0.5",
        className,
      )}
      {...(square ? { role: "img", "aria-label": label, title: label } : {})}
    >
      {square ? <span aria-hidden>{label.charAt(0)}</span> : label}
    </span>
  )
}

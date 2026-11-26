import { cn } from "@/lib/utils"

/** The two mounts of the incident detail: the modal and the side panel. */
export type DetailLayout = 'modal' | 'panel'

/**
 * The density and the grid every tab of the incident detail shares, per mount.
 * Called by `OperationDetailContent` and by each tab body it renders, so the
 * tabs keep one rhythm without passing four class names around.
 */
export function detailTabLayout(layout: DetailLayout) {
  // The modal is 90vw wide — a tab that only fills one narrow column wastes it.
  // The panel mount stays single-column; it is barely wider than one.
  //
  // `dense` is the SKIN, not the grammar: both mounts read `Label │ Wert` rows out
  // of the same `DetailField` since the creation modal took them too. What the flag
  // still decides is the control (borderless in the 420px panel, boxed where a
  // field can be empty), the column count and the tab-trigger sizing. The old note
  // here said the modal «keeps the stacked form»; it has not since 93300d2a.
  const dense = layout === 'panel'
  // The facts column is capped: rows built for the 420px panel sprawl on a
  // 1100px modal half — the toggle switches ended up 800px from their labels
  // and read as unaligned. The resources column takes what remains.
  // One vertical rhythm on every tab: 8px between two rows (each `DetailField`
  // brings its own `py-1`, nothing is stacked on top; 6px in the panel, whose root
  // sets `--detail-row-py: 3px`) and ONE section step
  // between two sections — the column groups, «Kräfte» and,
  // stacked in the panel, the two columns themselves (`gap-x-8` is the modal's
  // column gutter). The step is 12px in the panel and 16px in the modal, 8px from
  // a heading to its rows (`DetailGroupHeading`). The panel keeps 12 (hill climb
  // r11): at 16 the first «Kräfte» rows sit on the footer rule on a
  // laptop. Where the list still runs on under the footer, the panel fades out
  // while more is below (`scrollEndFade`, r18), so the cut is announced.
  const sectionStep = dense
    ? { gap: "gap-y-3", pad: "py-3", stack: "space-y-3", fields: "space-y-1.5" }
    : { gap: "gap-y-4", pad: "py-4", stack: "space-y-4", fields: "space-y-2" }
  const tabGridClass = cn(
    "grid grid-cols-1 gap-x-8",
    sectionStep.gap,
    sectionStep.pad,
    layout === 'modal' && "lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]",
  )
  // Die Spalten trennt eine Linie. Waagrecht bleibt es bei Abstand — eine
  // Haarlinie unter jeder Zeile sagt nichts, was der Zeilenumbruch nicht sagt —,
  // aber SENKRECHT ist der Fall ein anderer: zwei Spalten, die nur Luft
  // voneinander trennt, lesen sich bei langen Zeilen als eine, und ein Blick, der
  // von «Notizen» nach rechts wandert, landet in «Kräfte», ohne die Grenze
  // bemerkt zu haben.
  const tabColumnBreakClass = cn(sectionStep.stack, layout === 'modal' && "lg:border-l lg:border-border lg:pl-8")
  return { dense, sectionStep, tabGridClass, tabColumnBreakClass }
}

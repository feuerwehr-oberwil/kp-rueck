/**
 * THE overlay treatment, shared by every modal layer (dialog, alert-dialog,
 * sheet — modal and non-modal alike).
 *
 * One look on purpose: dialogs used to blur at `blur-sm` over black/60 while
 * sheets dimmed without any blur, so stacked or successive layers visibly
 * disagreed about how "modal" the app is. The blur is deliberately restrained
 * (2px over black/40): the board behind a modal stays readable — an operator
 * mid-dialog still sees a card move — the layer only has to say "you are in a
 * modal now", not hide the room.
 */
export const OVERLAY_CLASS = "bg-black/40 backdrop-blur-[2px]"

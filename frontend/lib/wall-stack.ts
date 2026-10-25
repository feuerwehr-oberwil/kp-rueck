/**
 * The wall boards on a phone (UX-PHONE-10 B): below `sm` the columns of
 * `/display/board` – logged-in and token – stack top to bottom and the board
 * scrolls down, the same wall cards, nothing sideways. CSS only; from `sm` up
 * every class here is inert and the boards are the wall as before.
 *
 * One class per element so both boards stay identical:
 */

/** The row of columns → a column of columns that scrolls vertically. */
export const WALL_STACK_BOARD = "max-sm:flex-col max-sm:gap-3.5 max-sm:overflow-y-auto"
/** A column: full width, as tall as its cards, no scroller of its own. */
export const WALL_STACK_COLUMN = "max-sm:min-w-0 max-sm:flex-none max-sm:overflow-visible"
/** A column body: grows with its cards (the board scrolls, not the column). */
export const WALL_STACK_BODY = "max-sm:flex-none max-sm:overflow-visible"
/** A folded column: the 48px vertical strip becomes a 48px full-width row. */
export const WALL_STACK_FOLDED = "max-sm:h-12 max-sm:w-full max-sm:flex-row max-sm:px-3 max-sm:pb-0"
/** The folded strip's accent rule: across the top of the row, out of the flow. */
export const WALL_STACK_FOLDED_ACCENT = "max-sm:absolute max-sm:inset-x-0 max-sm:top-0"
/** The folded strip's label reads across again. */
export const WALL_STACK_FOLDED_LABEL = "max-sm:[writing-mode:horizontal-tb]"

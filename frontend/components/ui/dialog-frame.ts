/**
 * The three window sizes and the one place every window opens (owner picks 4A and «Fixed top
 * edge» / «Always the board, never the trigger», 19.11.2026). `DialogContent` and
 * `AlertDialogContent` take `size` and build their frame from here; a call site never sets a
 * width, a `top` or a `translate` of its own (`dialog-frame.test.ts` holds every call site to
 * that). That removed a whole class of bug: an un-prefixed `max-w-2xl` lost to the primitive's
 * `sm:max-w-lg`, so several «wide» dialogs rendered at 512 px by accident.
 *
 * - **S 512** – questions and pickers (ConfirmDialog, Fahrer, Reko zuweisen, Auftrag wählen,
 *   Divera). A picker and the question over it are equally wide.
 *   A SHORT form – up to about three fields (Benutzer anlegen, Passwort zurücksetzen, Fahrzeug,
 *   Material, Standort and the like in Settings) – is S too: a role sentence may wrap there,
 *   which was shown and accepted (owner pick «Kurze Formulare = S», 19.11.2026).
 * - **M 672** – real forms (Neuer Einsatz, Person, Ereignis, Reko-Bericht, Ressourcen fehlen,
 *   Appell, Kennzahlen).
 * - **L 1152** – work surfaces (Fahrzeuge / Mannschaft / Material zuweisen, Routen-Editor,
 *   Einsatz-Detail), at most the board area less 2rem on every side.
 *
 * Where (desk, ≥768 px): S and M hang from a fixed line 10vh down and grow DOWNWARDS, so a list
 * that filters or a field that appears never moves the title or the search. L fills the board
 * area at a fixed height. All three centre on the BOARD – the viewport less the docked
 * notification sidebar (`--notification-sidebar-width`, 0 while it is closed) – whatever opened
 * them: a card, a pin, a footer pill, a row in a sheet. Only menus and small popovers sit at
 * their trigger. Heights inside S/M stay the existing scale (`modal-h-compact`,
 * `modal-h-tall`), capped by `--modal-room`: the room under the top line less the same gap at
 * the bottom, so the tallest window (the Appell) ends 10vh above the screen's edge, not 2vh
 * (feedback 19.11.2026). The cap lives here, once; globals.css reads it in the height scale.
 *
 * Phones (<768 px) keep what they had: centred on the screen, the screen less 1rem a side. A
 * phone form or picker is a bottom sheet anyway (FRONTEND.md «Phone geometry»).
 */
export type DialogSize = 'sm' | 'md' | 'lg'

const FRAME =
  'fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] w-full max-w-[calc(100%-2rem)] ' +
  'md:translate-y-0 md:left-[calc((100%_-_var(--notification-sidebar-width,0px))/2)]'

/** S and M on a desk: the top line, and as much room below it as leaves the same gap below. */
const HANG = 'md:top-[10vh] md:[--modal-room:calc(100dvh_-_20vh)]'

const SIZE: Record<DialogSize, string> = {
  sm: `sm:max-w-lg ${HANG}`,
  md: `sm:max-w-[min(42rem,calc(100%_-_2rem))] ${HANG}`,
  lg:
    'h-[88dvh] sm:max-w-[min(72rem,calc(100%_-_2rem))] md:top-8 md:h-[calc(100dvh_-_4rem)] ' +
    'md:max-w-[min(72rem,calc(100%_-_var(--notification-sidebar-width,0px)_-_4rem))]',
}

/** The position and width classes of a window of this size. */
export function dialogFrameClass(size: DialogSize): string {
  return `${FRAME} ${SIZE[size]}`
}

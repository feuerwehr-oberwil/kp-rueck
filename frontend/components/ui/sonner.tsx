'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Toaster as Sonner, ToasterProps, useSonner, toast } from 'sonner'

import { useIsMobile } from '@/components/ui/use-mobile'
import { TOAST_LAYER_ATTR } from '@/lib/toast-layer'
import { installToastLifetime } from '@/lib/toast-lifetime'
import { cn } from '@/lib/utils'

// Module scope, so the wrappers are in place before the first effect can toast —
// and before NotificationToasts' quiet-surface muting saves them as «originals».
installToastLifetime()

/**
 * ONE message surface (KP Front's rule, 25.09.2026): every toast is the same
 * neutral card; the tone lives only in the glyph it leads with (success green,
 * info slate, warning amber, error red). The single exception is a failure,
 * which keeps a light red trace in the card itself so it never reads like «done».
 *
 * `unstyled`, not more classes on top: sonner injects its stylesheet as plain
 * (unlayered) CSS at runtime, while every Tailwind utility lives in
 * `@layer utilities` — and unlayered rules beat layered ones whatever the
 * specificity. That is why the old `bg-success/10 …` tints never showed: every
 * toast came out white with a black button. `unstyled` drops sonner's look
 * (`[data-styled=true]`) and keeps its mechanics (stacking, swipe, timers); the
 * look below is ours. The two unlayered leftovers we still have to beat (font,
 * word breaking) and the running-out line are in globals.css («Toast lane»).
 */
const TOAST_CLASSNAMES: NonNullable<ToasterProps['toastOptions']>['classNames'] = {
  toast: cn(
    // text · action · ✕ in one row; it wraps only when the text would get less
    // than 8rem beside the button (see `content`) — then the button moves to a
    // second row and the sentence gets the full width. Forcing that second row
    // on every phone toast made «Einsatz gelöscht · Rückgängig» 110px tall and
    // three toasts covered half the screen. The ✕ is pinned top right (see
    // `closeButton`) and the padding keeps its column free, so it never wraps.
    'flex flex-wrap items-center gap-x-2 md:gap-x-3 gap-y-1 w-[var(--width)] min-h-14 rounded-lg border border-border',
    'text-popover-foreground shadow-lg py-1.5 pl-4 pr-4 has-[>[data-close-button]]:pr-14 text-sm',
  ),
  content: 'flex min-w-0 grow basis-32 flex-col gap-0.5 py-1.5',
  title: 'font-semibold leading-snug',
  description: 'leading-snug text-muted-foreground',
  icon: 'relative flex size-5 shrink-0 items-center justify-center [&>svg]:size-5',
  actionButton: cn(
    // `relative z-10` (and the ✕'s `z-10`): a toast that opens its Einsatz is a
    // tap target edge to edge (NotificationToasts), and its buttons sit above that
    'relative z-10 ml-auto inline-flex shrink-0 items-center rounded-md bg-muted px-3 h-9 max-md:h-11',
    'max-w-[min(240px,60vw)] whitespace-normal text-left text-sm font-semibold text-foreground',
    'cursor-pointer hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ),
  cancelButton: cn(
    'relative z-10 ml-auto inline-flex shrink-0 items-center rounded-md px-3 h-9 max-md:h-11',
    'text-sm font-medium text-muted-foreground cursor-pointer hover:bg-muted hover:text-foreground',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ),
  // sonner renders the ✕ first; it belongs at the right end of the first row, a
  // full 44px target. Pinned there (the toast itself is sonner's absolute box)
  // rather than a flex item: as a flex item it was the thing that wrapped, and
  // ended up alone at the left of a second row.
  closeButton: cn(
    'absolute top-1.5 right-1.5 z-10 grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground',
    'cursor-pointer hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ),
  // tone = the glyph's colour; the card stays neutral … (the fill is set per
  // type, not on `toast`: two background utilities on one element are decided
  // by stylesheet order, not by intent)
  default: 'bg-popover',
  loading: 'bg-popover',
  success: 'bg-popover [&_[data-icon]]:text-success',
  info: 'bg-popover [&_[data-icon]]:text-muted-foreground',
  warning: 'bg-popover [&_[data-icon]]:text-warning dark:[&_[data-icon]]:text-warning-foreground',
  // … except a failure, the one card with a trace of red in it
  error: cn(
    '[&_[data-icon]]:text-destructive border-destructive/30',
    'bg-[color:color-mix(in_oklab,var(--destructive)_6%,var(--popover))]',
    'dark:bg-[color:color-mix(in_oklab,var(--destructive)_14%,var(--popover))]',
  ),
}

/**
 * Where the lane sits on a phone: above the bottom navigation, above the topmost
 * open bottom sheet, and above the on-screen keyboard — whichever reaches highest.
 * The three variables are published on <html> by the phone layout; the fallbacks
 * keep this working without them (nav = 60px + its 1px border + safe area).
 */
export const PHONE_LANE_BOTTOM =
  'calc(max(var(--nav-reserve, calc(61px + env(safe-area-inset-bottom, 0px))), var(--sheet-top, 0px), var(--kb-inset, 0px)) + 8px)'

/**
 * `--width`: wider than sonner's 356px — «Status konnte nicht geändert werden»
 * beside «Erneut versuchen» and a 44px ✕ broke into five one-word lines.
 * `--normal-*`: sonner's dark theme paints the ✕ with these in a rule that
 * `unstyled` does not switch off (a black square on every dark toast). Set
 * inline on the container, they beat sonner's theme values; nothing else reads
 * them once the toasts are unstyled.
 */
const LANE_STYLE = {
  '--width': '420px',
  '--normal-bg': 'transparent',
  '--normal-bg-hover': 'var(--muted)',
  '--normal-border': 'transparent',
  '--normal-border-hover': 'transparent',
  '--normal-text': 'var(--muted-foreground)',
} as React.CSSProperties

/** Room the «Alle schliessen» pill takes at the foot of the lane (44px + 8px gap). */
const PILL_ROW = '52px'
// `--vv-top`: with the keyboard up iOS may have panned the visible band down the layout
// viewport; the lane follows it (0 otherwise). lib/viewport-insets.ts.
const PHONE_LANE_TOP = 'calc(var(--vv-top, 0px) + env(safe-area-inset-top, 0px) + 8px)'

// Stable identities — a fresh object per render re-runs sonner's positioning
// effect (toasts slid in from the wrong place during a burst).
//
// Desktop hugs the bottom-right corner: the pill takes the last 16px, the stack
// starts just above it, always (the board's footer bar is left of it).
const OFFSET_DESKTOP = { right: '16px', bottom: '56px' }
// Phone: the stack sits right on the lane while it is one toast, and steps one
// row away once the pill appears — a toast floating a pill's height above the
// nav for nothing looked detached. Passed as `mobileOffset` too: below 600px
// sonner ignores `offset` and used its own 16px, which put every toast ON the
// navigation, where it ate taps.
const SIDES = { right: '16px', left: '16px' }
const OFFSET_PHONE = {
  bottom: { ...SIDES, bottom: PHONE_LANE_BOTTOM },
  bottomWithPill: { ...SIDES, bottom: `calc(${PHONE_LANE_BOTTOM} + ${PILL_ROW})` },
  top: { ...SIDES, top: PHONE_LANE_TOP },
  topWithPill: { ...SIDES, top: `calc(${PHONE_LANE_TOP} + ${PILL_ROW})` },
}

/** Less than this above the topmost sheet, and a toast cannot sit there. */
export const MIN_ROOM_ABOVE_SHEET = 160

/**
 * Does the topmost open sheet leave room for the lane above it? Most of Rück's
 * phone sheets are nearly full height; «above the sheet» would push the stack
 * off the top of the screen. Then the lane moves to the top edge instead —
 * still clear of the sheet's buttons and the keyboard, which is the point.
 */
export function laneFitsAboveSheet(sheetTopPx: number, viewportHeight: number, keyboardUp = false): boolean {
  if (!(sheetTopPx > 0)) return true
  // With the keyboard up a phone sheet fills the whole visible band (globals.css): there is
  // no «above the sheet» on screen, so the lane goes to the band's top, over the sheet's head.
  if (keyboardUp) return false
  return viewportHeight - sheetTopPx >= MIN_ROOM_ABOVE_SHEET
}

type Lane = 'desktop' | 'bottom' | 'top'

/** Desktop, phone bottom lane, or phone top lane (a tall sheet is open). */
function useLane(): Lane {
  const isMobile = useIsMobile()
  const [fits, setFits] = useState(true)
  useEffect(() => {
    if (!isMobile) return
    // `--sheet-top` is published on <html> by the phone layout (inline style),
    // so a style mutation there is exactly when the answer can change.
    const check = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--sheet-top')
      const root = document.documentElement
      setFits(laneFitsAboveSheet(parseFloat(raw) || 0, window.innerHeight, root.hasAttribute('data-kb')))
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-kb'] })
    window.addEventListener('resize', check)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [isMobile])
  if (!isMobile) return 'desktop'
  return fits ? 'bottom' : 'top'
}

/** The app's one toast lane. Rendered once, by NotificationToasts. */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()
  const t = useTranslations('common')
  const lane = useLane()
  const { toasts } = useSonner()
  const withPill = toasts.length > 1
  const phoneOffset =
    lane === 'top'
      ? withPill ? OFFSET_PHONE.topWithPill : OFFSET_PHONE.top
      : withPill ? OFFSET_PHONE.bottomWithPill : OFFSET_PHONE.bottom

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position={lane === 'top' ? 'top-center' : 'bottom-right'}
      offset={lane === 'desktop' ? OFFSET_DESKTOP : phoneOffset}
      mobileOffset={phoneOffset}
      // fanned out, every toast readable — not a deck where only the front one is
      expand
      gap={8}
      style={LANE_STYLE}
      closeButton
      containerAriaLabel={t('toastRegion')}
      icons={{ close: <X className="pointer-events-none size-4" aria-hidden="true" /> }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: t('closeToast'),
        classNames: TOAST_CLASSNAMES,
      }}
      {...props}
    />
  )
}

const PILL_STYLE: Record<Lane, React.CSSProperties | undefined> = {
  desktop: undefined,
  bottom: { bottom: PHONE_LANE_BOTTOM },
  top: { top: PHONE_LANE_TOP, bottom: 'auto' },
}

const DismissAllToasts = () => {
  const { toasts } = useSonner()
  const t = useTranslations('common')
  const lane = useLane()

  if (toasts.length <= 1) return null

  return (
    // At the lane's own edge, the stack one row further in: desktop 16px from
    // the corner; phone where the lane starts (above nav / sheet / keyboard, or
    // the top edge while a tall sheet is open).
    <button
      type="button"
      // Part of the toast layer, but no sonner node – tag it so an open dialog
      // or slide-up does not read this click as "outside" and close itself.
      {...{ [TOAST_LAYER_ATTR]: '' }}
      onClick={() => toast.dismiss()}
      style={PILL_STYLE[lane]}
      className={cn(
        'fixed right-4 bottom-4 z-[9999] inline-flex h-9 max-md:h-11 items-center gap-1.5 rounded-full',
        'border border-border bg-popover px-3.5 text-sm font-medium text-muted-foreground shadow-lg',
        'cursor-pointer transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <X className="size-4" aria-hidden="true" />
      {t('dismissAllToasts')}
    </button>
  )
}

export { Toaster, DismissAllToasts }

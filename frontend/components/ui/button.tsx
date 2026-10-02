import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // The main action: an INK fill (`--action`, globals.css) — red never
        // fills an action here, it means priority and danger (CLAUDE.md →
        // Colour roles). One per surface: «Neuer Einsatz», «Fertig», «Anmelden».
        default: 'bg-action text-action-foreground hover:bg-action/90',
        // Red outline + red text, never a red fill: the action is dangerous,
        // not urgent, and a filled red button reads as the thing to press.
        // `dark:text-red-400` because the dark `--destructive` is tuned as a
        // FILL (deep, low-chroma) and as text on the dark board it falls
        // under 4.5:1.
        destructive:
          'border border-destructive/60 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/70 dark:text-red-400 dark:hover:bg-destructive/15 dark:hover:text-red-400 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        // The CHOSEN option of a choice — filter pill, segmented toggle, the
        // current status. Tonal slate («A2»), never a fill: a filled button
        // reads as an action, and red means priority/danger on this board.
        // Pair it with `outline` for the unchosen options (same 1px border, so
        // nothing shifts) and set `aria-pressed` / `aria-current` alongside.
        selected:
          'border border-sel-edge bg-sel-wash text-sel-foreground hover:bg-sel-wash hover:text-sel-foreground',
      },
      size: {
        default: 'min-h-[44px] px-4 py-2 has-[>svg]:px-3',
        sm: 'min-h-[36px] rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        // Desktop-only product (see CLAUDE.md): xs exists for dense panels —
        // Detailpanel, Auftragsliste, Ressourcenzeilen. Replaces the ~28
        // hand-written `h-7` (28px) strings that had grown into an unofficial
        // fifth size. Do not go below this.
        xs: 'min-h-[32px] rounded-md gap-1.5 px-2.5 text-xs has-[>svg]:px-2',
        lg: 'min-h-[48px] rounded-md px-6 has-[>svg]:px-4',
        icon: 'min-w-[44px] min-h-[44px]',
        'icon-sm': 'min-w-[36px] min-h-[36px]',
        'icon-xs': 'min-w-[32px] min-h-[32px]',
        'icon-lg': 'min-w-[48px] min-h-[48px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

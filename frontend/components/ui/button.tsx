import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        // Solid token in BOTH themes. The shadcn default `dark:bg-destructive/60`
        // blended the red 40% into the page background — washed-out fill, yet the
        // full-chroma token still screamed through. The dark `--destructive` token
        // itself is tuned instead (globals.css): deeper, lower-chroma, ≥4.5:1
        // with the near-white destructive-foreground on top.
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-muted hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
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

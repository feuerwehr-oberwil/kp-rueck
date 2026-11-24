import * as React from 'react'

import { cn } from '@/lib/utils'

/** The one multi-line field. It grows with its text (`field-sizing-content`), so a finger gets
 *  no resize grip (`pointer: coarse` – a mouse control it cannot drag; phone sweep 24.11.2026). */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input placeholder:text-muted-foreground aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content pointer-coarse:resize-none min-h-16 w-full rounded-md border bg-transparent px-(--field-px) py-2 text-base shadow-xs transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }

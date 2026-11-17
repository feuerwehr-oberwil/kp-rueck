/**
 * FormMessage — the one sentence under a field that says what is wrong with it.
 *
 * Two tones, and the tone is the contract:
 *
 * - `error` (red) BLOCKS saving. `role="alert"`, so a screen reader says it the
 *   moment it appears; the field carries `aria-invalid` and points here with
 *   `aria-describedby`; a submit that hits it moves the cursor into the first
 *   blocking field instead of greying the button out without a word.
 * - `advice` (amber) does NOT block. A polite `role="status"`, never an alert —
 *   an advisory announced like an error teaches people to stop reading both.
 *   The field is not `aria-invalid`; it is only described.
 *
 * Under the field, never as a toast: a toast is gone before the eye has found
 * the field it was about, and on a phone it lands on top of the keyboard.
 *
 * Wiring: give the field an `id`, render `<FormMessage id={formMessageId(id)}>`
 * and spread `fieldMessageProps(id, tone)` onto the control.
 */

import * as React from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'

import { cn } from '@/lib/utils'

export type FormMessageTone = 'error' | 'advice'

/** The id the message under the field `fieldId` carries. */
export function formMessageId(fieldId: string): string {
  return `${fieldId}-message`
}

/**
 * The attributes a control needs to be tied to its message: `aria-describedby`
 * while there is one, `aria-invalid` only when it blocks. `tone` undefined =
 * nothing to say, nothing to wire.
 */
export function fieldMessageProps(
  fieldId: string,
  tone: FormMessageTone | null | undefined,
): { 'aria-describedby'?: string; 'aria-invalid'?: boolean } {
  if (!tone) return {}
  return {
    'aria-describedby': formMessageId(fieldId),
    ...(tone === 'error' ? { 'aria-invalid': true } : {}),
  }
}

/**
 * Border for a field that carries ADVICE. The error border is the `Input`
 * primitive's own `aria-invalid:` styling; an advisory field is not invalid, so
 * it says so with an amber edge instead.
 */
export const FIELD_ADVICE_CLASS =
  'border-warning/80 focus-visible:border-warning focus-visible:ring-warning/25'

export interface FormMessageProps extends Omit<React.ComponentProps<'p'>, 'role'> {
  tone?: FormMessageTone
}

export function FormMessage({ tone = 'error', className, children, ...props }: FormMessageProps) {
  if (children == null || children === false || children === '') return null
  const Icon = tone === 'error' ? AlertCircle : AlertTriangle
  return (
    <p
      data-slot="form-message"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'flex items-start gap-1.5 text-xs leading-snug',
        tone === 'error' ? 'text-destructive' : 'text-warning-foreground',
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-px size-3.5 shrink-0',
          tone === 'advice' && 'text-warning-foreground',
        )}
      />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * Put the cursor into the first field that blocks. Called from a submit handler
 * AFTER the messages are set — by id, because the state that renders
 * `aria-invalid` has not reached the DOM yet in the same tick.
 */
export function focusFirstBlockingField(ids: Array<string | null | undefined | false>) {
  for (const id of ids) {
    if (!id) continue
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null
    if (el) {
      el.focus()
      return el
    }
  }
  return null
}

/**
 * A required text field that says so under itself instead of greying its submit
 * button out. The submit calls `check()`: false = the message shows and the cursor
 * is in the field. The message goes away as soon as there is text again.
 *
 *   const name = useRequiredField('group-name', value, t('nameRequired'))
 *   <Input {...name.controlProps} … />
 *   <FormMessage id={formMessageId('group-name')}>{name.error}</FormMessage>
 *   submit: if (!name.check()) return
 */
export function useRequiredField(id: string, value: string, message: string) {
  const [tried, setTried] = React.useState(false)
  const error = tried && !value.trim() ? message : undefined
  return {
    error,
    check: () => {
      if (value.trim()) return true
      setTried(true)
      focusFirstBlockingField([id])
      return false
    },
    /** Forget a failed submit – call when the form closes or starts over. */
    reset: () => setTried(false),
    controlProps: { id, ...fieldMessageProps(id, error ? 'error' : null) },
  }
}

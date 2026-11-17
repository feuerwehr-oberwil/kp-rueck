'use client'

import { type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowRight } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ShellLoader } from '@/components/ui/shell-loader'

/** Who closes the dialog. Exactly one of the two. */
type ConfirmDialogClosing =
  /** The dialog closes itself: Abbrechen, Esc and a confirm that resolved all call
   *  `onOpenChange(false)`. For a plain question over a boolean `open`. */
  | { onOpenChange: (open: boolean) => void; onCancel?: never }
  /** The CALLER closes it: `open` is derived from the caller's state, and every answer
   *  changes that state itself – the confirm, the `extraAction`, and Abbrechen/Esc, which
   *  call `onCancel`. For the board's gates, whose Abbrechen is an undo: with
   *  `onOpenChange`, a confirm would close through the same call as a cancel, from the
   *  render the click happened in, and undo the move it had just let stand. */
  | { onCancel: () => void; onOpenChange?: never }

type ConfirmDialogProps = ConfirmDialogClosing & {
  open: boolean
  title: ReactNode
  /** A glyph before the title (20px, muted unless it means something) – the gates name
   *  their subject with one. */
  icon?: ReactNode
  description: ReactNode
  onConfirm: () => Promise<void> | void
  confirmText?: string
  cancelText?: string
  /** `destructive` tints the confirm button red – for what cannot be taken back: delete,
   *  purge, revoke, rotate. A reversible answer (archive, release, deactivate, remove a
   *  driver or a function) stays ink: red means danger, not «this changes something». */
  variant?: 'default' | 'destructive'
  /** Optional content between the description and the answers (e.g. a list of
   *  affected items). Keep it short — this is a confirmation, not a form. */
  children?: ReactNode
  /** A third answer: the "…but do this instead" option («Trotzdem beenden», «Nur
   *  freigeben», «Rapport erfassen»). See `AlternativeAnswer` for its shape. It closes
   *  nothing by itself — the handler decides what happens next; while it runs (a
   *  promise) every answer waits. */
  extraAction?: { label: string; onSelect: () => Promise<void> | void }
}

/**
 * The third answer of a question, on a full-width line of its own ABOVE the
 * Abbrechen / main-answer row (owner pick INT-04 C, 17.11.2026): it gets room for a
 * whole phrase, it cannot be mistaken for Cancel, and the row under it stays the
 * footer every dialog has. Outline, the label left and a muted arrow right – «the
 * other way». `ConfirmDialog` draws it for `extraAction`; a three-answer dialog that
 * is not a confirmation (the training pickup question) uses it directly.
 */
export function AlternativeAnswer({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-auto w-full justify-between whitespace-normal text-left"
    >
      <span className="min-w-0 break-words">{children}</span>
      {busy ? <ShellLoader className="size-4" /> : <ArrowRight className="text-muted-foreground" aria-hidden />}
    </Button>
  )
}

/**
 * The single confirmation modal for the app. Encapsulates the AlertDialog
 * footer order (Cancel then Action), the spinner-plus-disabled loading state,
 * destructive tinting and the third answer's line — the pattern that was
 * re-hand-rolled in the board's status gates, the conflict and GPS prompts and
 * half a dozen inline AlertDialogs. `DeleteConfirmDialog` is this with
 * `variant="destructive"`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  title,
  icon,
  description,
  onConfirm,
  confirmText,
  cancelText,
  variant = 'default',
  children,
  extraAction,
}: ConfirmDialogProps) {
  const t = useTranslations('common.deleteConfirmDialog')
  const [busy, setBusy] = useState<'confirm' | 'extra' | null>(null)

  /**
   * Runs one answer. With `onOpenChange`, a confirm closes only once the handler
   * actually succeeded. A rejecting handler has already said what went wrong where
   * the operator is looking (toast or field message), so the dialog stays open and
   * the answers are live again — the question survives for a second try. A
   * confirmation that disappears on a failed write is a decision silently dropped,
   * which on a board run under load is the one outcome worth engineering against.
   *
   * Swallowing the rejection here is deliberate, not sloppy: the call site reports
   * it, whereas a throw out of this async event handler would surface only as an
   * unhandled rejection in the console.
   */
  const answer = async (which: 'confirm' | 'extra', handler: () => Promise<void> | void) => {
    setBusy(which)
    try {
      await handler()
      if (which === 'confirm') onOpenChange?.(false)
    } catch {
      // Reported by the handler; stay open for the retry.
    } finally {
      setBusy(null)
    }
  }

  const dismiss = () => (onCancel ? onCancel() : onOpenChange?.(false))

  return (
    // While an answer runs, Esc cannot take the question away either – Cancel is
    // already disabled, and a one-way write in flight must stay in view.
    <AlertDialog open={open} onOpenChange={(next) => !next && !busy && dismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={icon ? 'flex items-center gap-2' : undefined}>
            {icon}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {extraAction && (
          <AlternativeAnswer
            disabled={busy !== null}
            busy={busy === 'extra'}
            onClick={() => void answer('extra', extraAction.onSelect)}
          >
            {extraAction.label}
          </AlternativeAnswer>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy !== null}>{cancelText ?? t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              void answer('confirm', onConfirm)
            }}
            disabled={busy !== null}
            className={cn(buttonVariants({ variant }))}
          >
            {busy === 'confirm' && <ShellLoader className="mr-2 h-4 w-4" />}
            {confirmText ?? t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

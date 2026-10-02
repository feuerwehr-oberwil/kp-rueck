/**
 * EmptyState — what an empty list says: WHY it is empty, and the one way out.
 *
 * Quiet on purpose: a title, one line, at most one action. No big icon, no
 * illustration, no fade-in-up — an empty list in the middle of an Einsatz is
 * information, not an occasion. The repeated board columns do not use this at
 * all; they keep their single grey sentence.
 *
 * The four reasons a list is empty are four different sentences, and mixing
 * them up is the bug this exists to stop (a filter that hid every Fahrzeug used
 * to report «Alle Fahrzeuge sind bereits zugewiesen»):
 *   - a SEARCH found nothing   → «Keine Treffer für «xyz».» + «Suche leeren»
 *   - a FILTER hides everything → «Keine Treffer» + which filter + «Filter zurücksetzen»
 *   - there is truly NOTHING   → what it would take to have something
 *   - everything is TAKEN      → a line in the list, not a replacement for it
 *
 * `role="status"`: typing into a search and having the list go empty is a
 * change a screen reader user cannot see; the title is announced politely.
 */

import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  icon?: LucideIcon
}

export interface EmptyStateProps {
  title: React.ReactNode
  description?: React.ReactNode
  action?: EmptyStateAction
  className?: string
  /** Tighter padding for lists that sit in a narrow column or a sheet. */
  compact?: boolean
}

export function EmptyState({ title, description, action, className, compact = false }: EmptyStateProps) {
  const ActionIcon = action?.icon
  return (
    <div
      role="status"
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12',
        className,
      )}
    >
      <p className="text-sm font-semibold text-foreground text-balance">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground text-balance">{description}</p>
      )}
      {action && (
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={action.onClick}>
          {ActionIcon && <ActionIcon aria-hidden="true" />}
          {action.label}
        </Button>
      )}
    </div>
  )
}

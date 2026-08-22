"use client"

import { ArrowRight, Package, Plus, Truck, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { useOperations } from "@/lib/contexts/operations-context"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * A person, a vehicle and a Tauchpumpe are all single physical things — each can
 * only be in one place at a time. When an operator assigns one that is still on
 * another incident (see operations-context `resourceConflict`), this asks the
 * three questions that actually exist: *move* it here (release it there), *keep*
 * the double booking, or leave it alone.
 *
 * It is THE dialog for that question, from every entry point. There used to be a
 * second one inside the assignment dialog with the same title and only two of
 * the three answers — «Verschieben» was missing there entirely, and its
 * «Trotzdem zuweisen» did not say whether the person ended up on one incident or
 * on two. Same question, same answer set, wherever the assignment starts:
 * kanban drag-drop, map, command palette, context menu, assignment dialog,
 * Auftrag sheet.
 *
 * Both incidents are named in the body rather than only in running text —
 * «Bisher: Bahnhofstrasse 12» against «Neu: Rebgasse 8» — because whoever moves
 * a resource is deciding what it is taken away FROM.
 *
 * Mounted once in the root layout.
 */
export function ResourceConflictPrompt() {
  const t = useTranslations('incidents.resourceConflict')
  const tCommon = useTranslations('incidents.common')
  const { resourceConflict, resolveResourceConflict, cancelResourceConflict } = useOperations()

  if (!resourceConflict) return null

  const { resourceType, resourceName, conflicts, targetOperationLabel } = resourceConflict
  const Icon = resourceType === "vehicle" ? Truck : resourceType === "material" ? Package : User

  return (
    <AlertDialog open={true} onOpenChange={(open) => { if (!open) cancelResourceConflict() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {t('titleNamed', { name: resourceName })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('prompt')}</AlertDialogDescription>
        </AlertDialogHeader>

        {/* Bisher → Neu. Each row carries a word and a glyph, never a colour on
            its own: an arrow for a binding that exists, a plus for the one being
            made. */}
        <div className="rounded-lg border bg-muted/30 p-2 text-sm">
          {conflicts.map((conflict) => (
            <div key={conflict.operationId} className="flex items-start gap-2.5 px-1 py-1.5">
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span className="min-w-0">
                <span className="text-muted-foreground">{t('currentLabel')}: </span>
                <span className="font-medium text-foreground">{conflict.operationLabel}</span>
              </span>
            </div>
          ))}
          {targetOperationLabel && (
            <>
              <div className="my-1.5 h-px bg-border" />
              <div className="flex items-start gap-2.5 px-1 py-1.5">
                <Plus className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-muted-foreground">{t('newLabel')}: </span>
                  <span className="font-medium text-foreground">{targetOperationLabel}</span>
                </span>
              </div>
            </>
          )}
        </div>

        {/* One row, one height. «Abbrechen» quiet on the left, the two answers on
            the right with the primary one outermost — where the pointer is
            already heading. Moving is what the operator almost always means. */}
        <AlertDialogFooter>
          <Button variant="ghost" onClick={cancelResourceConflict} className="sm:mr-auto">
            {tCommon('cancel')}
          </Button>
          <Button variant="outline" onClick={() => resolveResourceConflict("keep")}>
            {t('keepBoth')}
          </Button>
          <Button onClick={() => resolveResourceConflict("move")}>
            {t('moveHere')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

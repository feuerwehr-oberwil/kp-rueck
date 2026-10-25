'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Ban, CircleSlash, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TableCell, TableHead } from '@/components/ui/table';
import { shortDate } from '@/lib/board-sidebar';
import {
  rowState,
  type ArchivableInventory,
  type ArchivableRow,
  type InventorySort,
  type LifecycleActions,
} from './use-archivable-inventory';

/**
 * The table pieces the inventory screens in Einstellungen share, fed by the
 * hooks in `use-archivable-inventory.ts`. Each screen still writes its own
 * `<Table>` and columns; these are the parts that were the same in all of them:
 *
 * - `SortableHead` – a clickable column head with its ▲/▼ (all three screens).
 * - `LifecycleHeads` + `LifecycleCells` – the «Nicht einsatzbereit», «Status»
 *   and «Aktionen» columns of a fleet/inventory row (Fahrzeuge, Material).
 * - `ArchiveToggle` – «Archivierte anzeigen» and the archived count.
 * - `ArchiveDialogs` – the archive and purge confirmations; the screen names
 *   its own copy.
 */

const SORTABLE = 'cursor-pointer hover:bg-muted/50 select-none';

function SortIndicator<C extends string>({ sort, column }: { sort: InventorySort<C>; column: C }) {
  if (sort.column !== column) return null;
  return sort.direction === 'asc' ? (
    <ArrowUp className="ml-1 h-3 w-3 inline" />
  ) : (
    <ArrowDown className="ml-1 h-3 w-3 inline" />
  );
}

/** `<SortableHead sort={inv.sort} column="name">Name</SortableHead>`; `className` goes in front. */
export function SortableHead<C extends string>({
  sort,
  column,
  className,
  children,
}: {
  sort: InventorySort<C>;
  column: NoInfer<C>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableHead
      className={className ? `${className} ${SORTABLE}` : SORTABLE}
      onClick={() => sort.toggle(column)}
    >
      {children}<SortIndicator sort={sort} column={column} />
    </TableHead>
  );
}

/** The three trailing heads matching `LifecycleCells`. */
export function LifecycleHeads<C extends string>({ sort }: { sort: InventorySort<C | 'status'> }) {
  const t = useTranslations('settings');
  return (
    <>
      <TableHead>{t('lifecycle.notReady')}</TableHead>
      <SortableHead sort={sort} column="status">
        {t('common.status')}
      </SortableHead>
      <TableHead className="text-right">{t('common.actions')}</TableHead>
    </>
  );
}

/** The three trailing cells of a row: readiness flag, status, actions. */
export function LifecycleCells<T extends ArchivableRow>({
  row,
  actions,
  onEdit,
}: {
  row: T;
  actions: LifecycleActions<T>;
  onEdit: (row: T) => void;
}) {
  const t = useTranslations('settings');
  const state = rowState(row);
  const isArchived = state === 'archived';
  return (
    <>
      <TableCell>
        {isArchived ? (
          <span className="text-muted-foreground">–</span>
        ) : (
          <span className="flex items-center gap-2">
            <Checkbox
              checked={row.out_of_service}
              onCheckedChange={(checked) => { void actions.setOutOfService(row, checked === true); }}
              aria-label={t('lifecycle.notReadyAria', { name: row.name })}
            />
            {row.out_of_service && row.out_of_service_since && (
              <span className="text-xs text-muted-foreground">
                {t('lifecycle.notReadySince', { date: shortDate(row.out_of_service_since) })}
              </span>
            )}
          </span>
        )}
      </TableCell>
      <TableCell>
        {/* Word + glyph, never colour on its own — three states that have to
            stay apart on a projector and in greyscale. */}
        {isArchived ? (
          <span className="space-y-0.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Archive className="size-3.5" />
              {t('lifecycle.archivedOn', { date: shortDate(row.archived_at) })}
            </span>
            <span className="block text-2xs text-muted-foreground">
              {row.assignment_count
                ? t('lifecycle.stoodOnIncidents', { count: row.assignment_count })
                : t('lifecycle.neverOnIncident')}
            </span>
          </span>
        ) : state === 'outOfService' ? (
          <span className="inline-flex items-center gap-1.5 rounded border border-dashed border-muted-foreground/60 px-2 py-1 text-xs font-medium text-muted-foreground">
            <Ban className="size-3.5" />
            {t('lifecycle.notReady')}
          </span>
        ) : /* Empty when the row is simply ready: a green chip on every normal
               row is colour without information — the cell speaks only for
               exceptions. */ null}
      </TableCell>
      <TableCell className="text-right">
        {isArchived ? (
          <span className="inline-flex gap-1">
            <Button variant="outline" size="sm" onClick={() => { void actions.restore(row); }}>
              <ArchiveRestore className="size-3.5" />
              {t('lifecycle.restore')}
            </Button>
            {/* Greyed on the API's own answer (`can_delete`), with the reason in
                the title — the button and the 409 rule can never drift apart
                because they read the same field. */}
            <Button
              variant="outline"
              size="sm"
              disabled={row.can_delete === false}
              title={
                row.can_delete === false
                  ? t('lifecycle.stoodOnIncidents', { count: row.assignment_count ?? 0 })
                  : undefined
              }
              onClick={() => actions.requestPurge(row)}
              className={row.can_delete === false ? undefined : 'text-destructive hover:bg-destructive/10 hover:text-destructive'}
            >
              <Trash2 className="size-3.5" />
              {t('lifecycle.deletePermanently')}
            </Button>
          </span>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => onEdit(row)}>
              <Edit className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => actions.requestArchive(row)}
              title={t('lifecycle.archive')}
              aria-label={t('lifecycle.archive')}
            >
              <Archive className="size-3.5" />
            </Button>
          </>
        )}
      </TableCell>
    </>
  );
}

/**
 * «Archivierte anzeigen». The archive is opened, not filtered: off, the
 * endpoint returns no archived rows at all. The count on the right is the only
 * hint that anything is behind the toggle. `className` is appended.
 */
export function ArchiveToggle({
  inventory,
  className,
}: {
  inventory: Pick<ArchivableInventory<ArchivableRow, string>, 'showArchived' | 'toggleShowArchived' | 'archivedCount'>;
  className?: string;
}) {
  const t = useTranslations('settings');
  return (
    <div className={`flex items-center justify-between gap-3${className ? ` ${className}` : ''}`}>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={inventory.showArchived} onCheckedChange={() => { void inventory.toggleShowArchived(); }} />
        {t('lifecycle.showArchived')}
      </label>
      {inventory.showArchived && (
        <span className="text-xs text-muted-foreground">
          {t('lifecycle.archivedCount', { count: inventory.archivedCount })}
        </span>
      )}
    </div>
  );
}

/** The screen's own sentences for the two confirmations. */
export interface ArchiveDialogCopy {
  archiveTitle: string;
  archiveDescription: string;
  archiveHint: string;
  purgeTitle: string;
  purgeDescription: string;
  purgeHint: string;
}

/**
 * Archiving is the normal way out, and its dialog says what it actually does
 * (the old one promised «kann nicht rückgängig gemacht werden» and then only
 * set a status, leaving the row on the board). Purging is the rare way – typos
 * and test entries – only reachable from the archive, and only for rows the
 * API says may go (`can_delete`).
 */
export function ArchiveDialogs({
  inventory,
  copy,
}: {
  inventory: Pick<
    ArchivableInventory<ArchivableRow, string>,
    'archiveOpen' | 'setArchiveOpen' | 'confirmArchive' | 'purgeTarget' | 'cancelPurge' | 'confirmPurge'
  >;
  copy: ArchiveDialogCopy;
}) {
  const t = useTranslations('settings');
  return (
    <>
      <ConfirmDialog
        open={inventory.archiveOpen}
        onOpenChange={inventory.setArchiveOpen}
        title={copy.archiveTitle}
        description={copy.archiveDescription}
        confirmText={t('lifecycle.archive')}
        onConfirm={inventory.confirmArchive}
      >
        <div className="rounded-lg border p-3 text-sm">
          <p className="flex items-start gap-2">
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.archiveConsequenceDrop')}
          </p>
          <p className="mt-2 flex items-start gap-2">
            <ArchiveRestore className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.archiveConsequenceRestore')}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{copy.archiveHint}</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!inventory.purgeTarget}
        onOpenChange={(open) => { if (!open) inventory.cancelPurge(); }}
        variant="destructive"
        title={copy.purgeTitle}
        description={copy.purgeDescription}
        confirmText={t('lifecycle.deletePermanently')}
        onConfirm={inventory.confirmPurge}
      >
        <div className="rounded-lg border p-3 text-sm">
          <p className="flex items-start gap-2">
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.purgeConsequenceLists')}
          </p>
          <p className="mt-2 flex items-start gap-2">
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.purgeConsequenceNoReturn')}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{copy.purgeHint}</p>
        </div>
      </ConfirmDialog>
    </>
  );
}

'use client';

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api-client';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes-warning';

/**
 * The state behind the three inventory tables in Einstellungen (Fahrzeuge,
 * Material, Personal). Three layers, each screen takes the ones it has:
 *
 * - `useInventoryList` – rows loaded once on mount, kept on a degraded GET,
 *   sorted by one clickable column. All three screens.
 * - `useArchivableInventory` – the list plus the lifecycle a fleet/inventory row
 *   goes through: «Nicht einsatzbereit», archive, restore, purge, and the
 *   archive toggle. Fahrzeuge and Material; personnel is hard-deleted and has no
 *   archive.
 * - `useInventoryDialog` – the create/edit dialog's open/editing state, the form
 *   reset and the unsaved-changes guard. All three screens.
 *
 * The matching table pieces (sortable heads, lifecycle cells, the archive/purge
 * dialogs) are in `inventory-table.tsx`.
 */

export type SortDirection = 'asc' | 'desc';

/** One table's sort: a column, a direction, and the header click that moves them. */
export interface InventorySort<C extends string> {
  column: C;
  direction: SortDirection;
  /** Same column flips the direction; another column starts ascending. */
  toggle(column: C): void;
}

/** Compares two rows on one column, ascending. The list applies the direction. */
export type InventoryCompare<T, C extends string> = (a: T, b: T, column: C) => number;

export interface InventoryList<T, C extends string> {
  /** As loaded, in server order – for derived pick lists and counts. */
  rows: T[];
  setRows: Dispatch<SetStateAction<T[]>>;
  /** `rows` in the table's order. Archived rows always sink to the bottom. */
  sorted: T[];
  sort: InventorySort<C>;
  reload: (includeArchived?: boolean) => Promise<void>;
}

/**
 * Rows of one settings table. `compare` must be stable (a module-level
 * function): it is a memo dependency. `logLabel` names the rows in the console
 * line of a failed load («Failed to load vehicles:»).
 */
export function useInventoryList<T extends { id: string; archived_at?: string | null }, C extends string>({
  list,
  compare,
  initialSort,
  loadError,
  logLabel,
}: {
  list: (includeArchived: boolean) => Promise<T[] | undefined>;
  compare: InventoryCompare<T, C>;
  initialSort: C;
  /** Toast title when the very first load comes back empty-handed. */
  loadError: string;
  logLabel: string;
}): InventoryList<T, C> {
  const t = useTranslations('settings');
  const [rows, setRows] = useState<T[]>([]);
  const [column, setColumn] = useState<C>(initialSort);
  const [direction, setDirection] = useState<SortDirection>('asc');

  const reload = async (includeArchived = false) => {
    try {
      const data = await list(includeArchived);
      if (!data) {
        // GET degraded to undefined after retries — keep previous state instead
        // of crashing the sort memos with a non-iterable value.
        if (rows.length === 0) {
          toast.error(loadError, {
            description: t('common.reloadPage'),
          });
        }
        return;
      }
      setRows(data);
    } catch (error) {
      console.error(`Failed to load ${logLabel}:`, error);
    }
  };

  // Load once on mount. `reload` is a plain function re-created on every
  // render, so listing it as a dep would refetch on every render.
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    const sign = direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      // Archived rows always sink to the bottom, whatever the column: they are a
      // second list, not a peer of the rows above them.
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
      return sign * compare(a, b, column);
    });
  }, [rows, column, direction, compare]);

  const toggle = (next: C) => {
    if (column === next) {
      setDirection(direction === 'asc' ? 'desc' : 'asc');
    } else {
      setColumn(next);
      setDirection('asc');
    }
  };

  return { rows, setRows, sorted, sort: { column, direction, toggle }, reload };
}

/** What a vehicle or a material row shares: readiness and lifecycle. */
export interface ArchivableRow {
  id: string;
  name: string;
  out_of_service: boolean;
  out_of_service_since: string | null;
  archived_at: string | null;
  assignment_count: number | null;
  can_delete: boolean | null;
}

/** Lifecycle/readiness of one row. Deployment is per-Ereignis and lives on the
 *  board, so it is deliberately absent here — claiming «Im Einsatz» from a
 *  station-wide list would be a guess. */
export type RowState = 'archived' | 'outOfService' | 'available';

export function rowState(row: ArchivableRow): RowState {
  if (row.archived_at) return 'archived';
  if (row.out_of_service) return 'outOfService';
  return 'available';
}

const STATE_RANK: Record<RowState, number> = { available: 0, outOfService: 1, archived: 2 };

/** Sort key of the «Status» column: ready, not ready, archived. */
export function rowStateRank(row: ArchivableRow): number {
  return STATE_RANK[rowState(row)];
}

/** The per-row actions the lifecycle cells call. */
export interface LifecycleActions<T> {
  setOutOfService: (row: T, outOfService: boolean) => Promise<void>;
  restore: (row: T) => Promise<void>;
  /** Opens the archive confirmation for `row`. */
  requestArchive: (row: T) => void;
  /** Opens the purge confirmation for `row`. */
  requestPurge: (row: T) => void;
}

export interface ArchivableInventory<T, C extends string>
  extends InventoryList<T, C>,
    LifecycleActions<T> {
  /** Reloads with the archive toggle's current value unless told otherwise. */
  reload: (includeArchived?: boolean) => Promise<void>;
  showArchived: boolean;
  toggleShowArchived: () => Promise<void>;
  archivedCount: number;
  /** State for `ArchiveDialogs`. */
  archiveTarget: T | null;
  archiveOpen: boolean;
  setArchiveOpen: (open: boolean) => void;
  confirmArchive: () => Promise<void>;
  purgeTarget: T | null;
  cancelPurge: () => void;
  confirmPurge: () => Promise<void>;
}

/**
 * A fleet or inventory table with its lifecycle. `api` are the five endpoints
 * of the resource; `failureDescription` is the screen's own toast line when an
 * archive or purge fails for no reason the API names; `logNoun` («vehicle»)
 * names the row in console lines.
 */
export function useArchivableInventory<T extends ArchivableRow, C extends string>({
  api,
  compare,
  initialSort,
  loadError,
  failureDescription,
  logNoun,
}: {
  api: {
    list: (includeArchived: boolean) => Promise<T[] | undefined>;
    archive: (id: string) => Promise<unknown>;
    restore: (id: string) => Promise<unknown>;
    purge: (id: string) => Promise<unknown>;
    setOutOfService: (id: string, outOfService: boolean) => Promise<T>;
  };
  compare: InventoryCompare<T, C>;
  initialSort: C;
  loadError: string;
  failureDescription: string;
  logNoun: string;
}): ArchivableInventory<T, C> {
  const t = useTranslations('settings');
  const inventory = useInventoryList<T, C>({
    list: api.list,
    compare,
    initialSort,
    loadError,
    logLabel: `${logNoun}s`,
  });
  const { rows, setRows } = inventory;
  // The archive is a second, quieter list behind a toggle — not a filter over
  // the same rows. Off, the endpoint does not even return them.
  const [showArchived, setShowArchived] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<T | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<T | null>(null);

  const reload = (includeArchived = showArchived) => inventory.reload(includeArchived);

  const archivedCount = useMemo(() => rows.filter((row) => row.archived_at).length, [rows]);

  /** The normal way to retire a row: reversible, and it really does leave the
   *  board — the dialog that leads here names both facts. Like the purge below,
   *  the API refuses with 409 while the row stands on an open Einsatz — that
   *  answer gets its own sentence instead of the generic failure. */
  const confirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      await api.archive(archiveTarget.id);
      await reload();
    } catch (error) {
      console.error(`Failed to archive ${logNoun}:`, error);
      toast.error(t('lifecycle.archiveError'), {
        description: ApiError.isConflictError(error)
          ? t('lifecycle.archiveInUseDescription')
          : failureDescription,
      });
    } finally {
      setArchiveTarget(null);
    }
  };

  const restore = async (row: T) => {
    try {
      await api.restore(row.id);
      await reload();
    } catch (error) {
      console.error(`Failed to restore ${logNoun}:`, error);
      toast.error(t('lifecycle.restoreError'));
    }
  };

  /** The rare way. The API refuses with 409 and a German sentence when the row
   *  stood on a live Einsatz — surface that sentence rather than inventing one. */
  const confirmPurge = async () => {
    if (!purgeTarget) return;
    try {
      await api.purge(purgeTarget.id);
      await reload();
    } catch (error) {
      console.error(`Failed to delete ${logNoun} permanently:`, error);
      toast.error(t('lifecycle.purgeError'), {
        description: error instanceof ApiError ? error.message : failureDescription,
      });
    } finally {
      setPurgeTarget(null);
    }
  };

  /** «Nicht einsatzbereit» — the same single field, the same `{ out_of_service }`
   *  PUT the board's right-click menu sends. */
  const setOutOfService = async (row: T, outOfService: boolean) => {
    try {
      const updated = await api.setOutOfService(row.id, outOfService);
      setRows((list) => list.map((r) => (r.id === row.id ? updated : r)));
    } catch (error) {
      console.error(`Failed to change ${logNoun} readiness:`, error);
      toast.error(t('lifecycle.notReadyError'));
    }
  };

  const toggleShowArchived = async () => {
    const next = !showArchived;
    setShowArchived(next);
    await reload(next);
  };

  return {
    ...inventory,
    reload,
    showArchived,
    toggleShowArchived,
    archivedCount,
    setOutOfService,
    restore,
    requestArchive: (row) => {
      setArchiveTarget(row);
      setArchiveOpen(true);
    },
    requestPurge: setPurgeTarget,
    archiveTarget,
    archiveOpen,
    setArchiveOpen,
    confirmArchive,
    purgeTarget,
    cancelPurge: () => setPurgeTarget(null),
    confirmPurge,
  };
}

/**
 * The create/edit dialog of one table. `open(row, values)` fills the form and
 * opens it (`row` null = create); `close()` resets to `defaults`; `guard` is the
 * unsaved-changes guard to wire into the Dialog and its Cancel button.
 * `onReset` clears screen-local inputs that live outside the form.
 */
export function useInventoryDialog<T, V extends FieldValues>(
  form: UseFormReturn<V>,
  defaults: V,
  onReset?: () => void,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);

  const close = () => {
    setIsOpen(false);
    setEditing(null);
    onReset?.();
    form.reset(defaults);
  };

  const guard = useUnsavedChangesWarning({
    isDirty: form.formState.isDirty,
    isOpen,
    onClose: close,
  });

  const open = (row: T | null, values: V) => {
    setEditing(row);
    onReset?.();
    form.reset(values);
    setIsOpen(true);
  };

  return { isOpen, editing, open, close, guard };
}

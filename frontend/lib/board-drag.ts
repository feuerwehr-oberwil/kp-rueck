/**
 * What a drag on the board carries, and where it can land. The producers (cards, sidebar
 * people and material, Auftrag rows) build their payloads `satisfies BoardDragSource` /
 * `satisfies BoardDropTarget`; the one monitor (`lib/hooks/use-kanban-drag-drop.ts`)
 * reads them through `readBoardDrag` / `readBoardDrop`. A renamed field is then a tsc
 * error at the producer, not a drop that silently does nothing.
 *
 *   getInitialData: () => ({ type: 'material', material }) satisfies BoardDragSource
 */
import type { Material, Operation, OperationStatus, Person } from '@/lib/contexts/operations-context'

/** A drag source's payload (`getInitialData`). */
export type BoardDragSource =
  | { type: 'operation'; operation: Operation; index: number }
  | { type: 'person'; person: Person }
  /** A driver chip drags as its vehicle. */
  | { type: 'driver-vehicle'; vehicleId: string; vehicleName: string }
  | { type: 'material'; material: Material }
  /** Every available unit of a material block. */
  | { type: 'material-group'; materials: Material[] }

/** A drop target's payload (`getData`). A card target carries the closest edge too
 *  (`attachClosestEdge`); the detail panel's has no `index` (it takes no card). */
export type BoardDropTarget =
  | { type: 'operation-drop'; operationId: string; index?: number }
  | { type: 'column'; columnId: OperationStatus }
  | { type: 'group-row'; groupId: string }
  | { type: 'group-stop'; groupId: string; incidentId: string; index: number }

type DragData = Record<string | symbol, unknown>

const SOURCE_TYPES: ReadonlySet<unknown> = new Set<BoardDragSource['type']>([
  'operation',
  'person',
  'driver-vehicle',
  'material',
  'material-group',
])
const TARGET_TYPES: ReadonlySet<unknown> = new Set<BoardDropTarget['type']>([
  'operation-drop',
  'column',
  'group-row',
  'group-stop',
])

/** The board payload this drag carries, or null for another surface's drag (a route-stop
 *  or settings sort). Only board producers send these types, and they build the payload
 *  `satisfies BoardDragSource`. */
export function readBoardDrag(data: DragData): BoardDragSource | null {
  return isBoardDragSource(data) ? data : null
}

/** The board target under the pointer, or null for another surface's target. */
export function readBoardDrop(data: DragData): BoardDropTarget | null {
  return isBoardDropTarget(data) ? data : null
}

function isBoardDragSource(data: DragData): data is DragData & BoardDragSource {
  return SOURCE_TYPES.has(data.type)
}

function isBoardDropTarget(data: DragData): data is DragData & BoardDropTarget {
  return TARGET_TYPES.has(data.type)
}

/** A drag that would assign something: a person, a vehicle (driver chip) or material. */
export function isResourceDrag(data: DragData): boolean {
  const drag = readBoardDrag(data)
  return drag !== null && drag.type !== 'operation'
}

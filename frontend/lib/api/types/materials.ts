/**
 * Material resource + group types.
 */

export interface ApiMaterialResource {
  id: string // UUID
  name: string
  type: string
  /** LEGACY mirror of `out_of_service`, kept in lockstep server-side
   *  ('unavailable' ⇔ out_of_service). Read `out_of_service` instead — this
   *  field says nothing about deployment, which is per-Ereignis and lives in
   *  the incident assignments. */
  status: string // available | unavailable
  location?: string | null
  /** Sort order for grouping by location */
  location_sort_order: number
  consumable: boolean
  group_id: string | null
  /** «Nicht einsatzbereit» — readiness, the first of the three axes. Beats
   *  assigned, which beats available. */
  out_of_service: boolean
  /** Server-stamped moment the flag was set; feeds the «seit 19.08.» line. */
  out_of_service_since: string | null
  /** Lifecycle: non-null means the row left the inventory. List endpoints only
   *  return it with `?include_archived=true`. */
  archived_at: string | null
  /** How many distinct Einsätze this item ever stood on. Null where the
   *  endpoint did not compute it (group listings, board snapshots). */
  assignment_count: number | null
  /** Whether `DELETE …?permanent=true` would succeed. Null = not computed. */
  can_delete: boolean | null
  created_at: string
  updated_at: string
}

export interface ApiMaterialCreate {
  name: string
  type: string
  status: string
  location?: string | null
  location_sort_order?: number
  consumable?: boolean
  group_id?: string | null
  /** Wins over `status` when both are sent. */
  out_of_service?: boolean
}

export interface ApiMaterialUpdate {
  name?: string
  type?: string
  status?: string
  location?: string | null
  location_sort_order?: number
  consumable?: boolean
  group_id?: string | null
  /** The single write path for «Nicht einsatzbereit» — right-click on the board
   *  sidebar row and the settings row both send this one field. */
  out_of_service?: boolean
}

export interface ApiMaterialGroup {
  id: string
  name: string
  description: string | null
  location: string
  location_sort_order: number
  materials: ApiMaterialResource[]
  created_at: string
  updated_at: string
}

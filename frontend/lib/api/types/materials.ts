/**
 * Material resource + group types.
 */

export interface ApiMaterialResource {
  id: string // UUID
  name: string
  type: string
  status: string // available, assigned, planned, maintenance
  location?: string | null
  /** Sort order for grouping by location */
  location_sort_order: number
  consumable: boolean
  group_id: string | null
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
}

export interface ApiMaterialUpdate {
  name?: string
  type?: string
  status?: string
  location?: string | null
  location_sort_order?: number
  consumable?: boolean
  group_id?: string | null
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

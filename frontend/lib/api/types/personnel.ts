/**
 * Personnel resource types.
 */

export interface ApiPersonnel {
  id: string // UUID
  name: string
  role?: string | null // e.g., "Firefighter", "Paramedic", "Driver"
  role_sort_order: number // Sort order for grouping by role
  availability: string // available, assigned, unavailable
  tags?: string[] | null
  checked_in: boolean
  checked_in_at: string | null
  checked_out_at: string | null
  created_at: string
  updated_at: string
}

export interface ApiPersonnelListItem {
  id: string
  name: string
  role?: string | null
  tags?: string[] | null
  checked_in: boolean
  /** Whether assigned to any incident in this event */
  is_assigned?: boolean
}

export interface ApiPersonnelCreate {
  name: string
  role?: string | null
  role_sort_order?: number
  availability: string
  tags?: string[] | null
}

export interface ApiPersonnelUpdate {
  name?: string
  role?: string | null
  role_sort_order?: number
  availability?: string
  tags?: string[] | null
}

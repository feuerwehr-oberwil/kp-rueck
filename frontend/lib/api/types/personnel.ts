/**
 * Personnel resource types.
 */

export interface ApiPersonnel {
  id: string // UUID
  name: string
  role?: string | null // e.g., "Firefighter", "Paramedic", "Driver"
  role_sort_order: number // Sort order for grouping by role
  status: string // available, unavailable
  tags?: string[] | null
  /** True when the person has a Divera identity (addressable for outbound alarms).
   *  The provider-side id itself stays server-side. */
  divera_linked?: boolean
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
  /** available | unavailable — the board greys out the latter, the phone never sees it. */
  status?: string
  tags?: string[] | null
  checked_in: boolean
  /** Set once the person has ever been present at this Ereignis. */
  checked_in_at?: string | null
  /** Set when they left. Together with `checked_in` this is what separates the board's
   *  "gegangen" from "nicht anwesend"; the phone stays two-state and ignores both. */
  checked_out_at?: string | null
  /** Whether assigned to any incident in this event */
  is_assigned?: boolean
}

export interface ApiCheckInStats {
  /** Everybody the roll-call offers — the Mannschaft. */
  total_available: number
  /** Present right now. */
  checked_in: number
  /** Simply not present, whether they came and went or never came. */
  checked_out: number
  /** Came and went. "Gegangen" is a statement, not an absence. */
  left: number
}

export interface ApiPersonnelCreate {
  name: string
  role?: string | null
  role_sort_order?: number
  status: string
  tags?: string[] | null
}

export interface ApiPersonnelUpdate {
  name?: string
  role?: string | null
  role_sort_order?: number
  status?: string
  tags?: string[] | null
}

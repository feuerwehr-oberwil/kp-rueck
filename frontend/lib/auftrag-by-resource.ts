import type { GroupResourceType, IncidentGroup } from '@/lib/types/groups'

/**
 * Which Auftrag holds a resource, by resource id – read off the route-level
 * assignments (`IncidentGroup.assignments`), the only place a route's crew,
 * vehicles and material are recorded (the stops carry none).
 *
 * One answer for every surface that says where a resource is: the board
 * sidebar's where-line (`usePersonEngagements`) and the wall's destination
 * column (/display/status) both read it, so the wall cannot leave blank what
 * the sidebar calls «Sturmholz Oberwil». The first Auftrag in the list wins.
 */
export function auftragByResource(
  groups: readonly IncidentGroup[],
  type: GroupResourceType,
): Map<string, IncidentGroup> {
  const map = new Map<string, IncidentGroup>()
  for (const group of groups) {
    for (const a of group.assignments) {
      if (a.resourceType === type && !map.has(a.resourceId)) map.set(a.resourceId, group)
    }
  }
  return map
}

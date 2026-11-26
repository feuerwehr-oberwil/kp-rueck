/**
 * Auftrag (incident group) API types — an ordered multi-stop route over incidents.
 *
 * An Auftrag is a lightweight ordered container over real incidents. Each stop
 * stays a first-class incident; the route OWNS its resources (vehicles, crew,
 * material) via group assignments — the stops themselves carry none.
 */

import type { In, Out, SentOrOmitted } from '../wire'

/** Resource kinds a route can own (drives the assign body `resource_type`). */
export type GroupResourceType = Out<'GroupAssignmentResponse'>['resource_type']

/** Derived checklist roll-up of an Auftrag's member stops. */
export type ApiGroupProgress = Out<'GroupProgress'>

/** A single resource attached to an Auftrag (route-owned, not per-stop). */
export type ApiGroupAssignment = Out<'GroupAssignmentResponse'>

export type ApiIncidentGroup = Out<'IncidentGroupResponse'>

/** What «Übertragen» onto an Auftrag wrote – the ids its «Rückgängig» sends back. */
export type ApiTransferToAuftragResult = Out<'TransferToAuftragResponse'>

/** Body for recording a Funkdurchsage (see `ApiIncidentGroup.last_announced_*`). */
export type ApiGroupAnnouncement = In<'GroupAnnouncementRequest'>

export type ApiIncidentGroupCreate = In<'IncidentGroupCreate'>

/** Partial PATCH payload (name / color / notes). An Auftrag always has a name. */
export type ApiIncidentGroupUpdate = SentOrOmitted<In<'IncidentGroupUpdate'>, 'name'>

/** Body for attaching a resource to a route. */
export type ApiGroupAssignmentCreate = In<'GroupAssignmentCreate'>

// --- Standard-Aufträge (Auftrag templates) --------------------------------
// Station configuration, not event data: a template outlives every Lage and is
// edited in Einstellungen. `auto_create` decides whether a new event opens with
// this Auftrag already on the board.

/**
 * Narrower than `GroupResourceType` on purpose (and CHECK-constrained in the
 * database): a template names equipment, never people — who is on a squad is
 * decided per Lage from who actually turned up.
 */
export type TemplateResourceType = Out<'AuftragTemplateResourceRef'>['resource_type']

/** One vehicle or material a template brings along by default. */
export type ApiAuftragTemplateResource = Out<'AuftragTemplateResourceRef'>

export type ApiAuftragTemplate = Out<'AuftragTemplateResponse'>

export type ApiAuftragTemplateCreate = In<'AuftragTemplateCreate'>

/** Partial PATCH. A present `resources` list REPLACES the stored one. */
export type ApiAuftragTemplateUpdate = SentOrOmitted<In<'AuftragTemplateUpdate'>, 'name' | 'auto_create' | 'resources'>

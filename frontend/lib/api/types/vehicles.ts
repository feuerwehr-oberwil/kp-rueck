/**
 * Vehicle + GPS / Traccar types.
 */

import type { In, Out } from '../wire'

export type ApiVehicle = Out<'Vehicle'>

export type ApiVehicleCreate = In<'VehicleCreate'>

export type ApiVehicleUpdate = In<'VehicleUpdate'>

/** An Einsatz a vehicle serves right now (`GET /api/vehicles/status`). */
export type ApiVehicleEinsatzDeployment = Out<'VehicleEinsatzDeployment'>

/** An Auftrag (route) a vehicle drives right now (`GET /api/vehicles/status`). */
export type ApiVehicleAuftragDeployment = Out<'VehicleAuftragDeployment'>

export type ApiVehicleDeployment = ApiVehicleAuftragDeployment | ApiVehicleEinsatzDeployment

/** A fleet vehicle with its driver and every Auftrag and Einsatz it serves in one event. */
export type ApiVehicleStatus = Out<'VehicleStatusResponse'>

export type ApiAssignedVehicle = Out<'AssignedVehicle'>

// Traccar GPS Tracking Types
export type ApiTraccarStatus = Out<'TraccarStatusResponse'>

export type ApiVehiclePosition = Out<'VehiclePositionResponse'>

/** Active simulated GPS drive (Übungssteuerung). */
export type ApiGpsSimDrive = Out<'GpsSimDriveResponse'>

export type ApiGpsSimStopped = Out<'GpsSimStopped'>

export type ApiTrailPoint = Out<'TrailPointResponse'>

export type ApiVehicleTrail = Out<'VehicleTrailResponse'>

/**
 * Material resource + group types.
 */

import type { In, Out } from '../wire'

/** `status` is the LEGACY mirror of `out_of_service`, kept in lockstep server-side
 *  ('unavailable' ⇔ out_of_service): read `out_of_service`. Deployment is per Ereignis
 *  and lives in the incident assignments. `assignment_count` / `can_delete` are null where
 *  the endpoint did not compute them (group listings, board snapshots). */
export type ApiMaterialResource = Out<'Material'>

/** `out_of_service` wins over `status` when both are sent. */
export type ApiMaterialCreate = In<'MaterialCreate'>

/** `out_of_service` is the single write path for «Nicht einsatzbereit». */
export type ApiMaterialUpdate = In<'MaterialUpdate'>

export type ApiMaterialGroup = Out<'MaterialGroupResponse'>

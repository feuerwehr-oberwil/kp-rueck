/**
 * Materials and material groups.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type {
  BulkCategorySortOrderUpdate,
  ApiMaterialResource,
  ApiMaterialCreate,
  ApiMaterialUpdate,
  ApiMaterialGroup,
} from '../types'

export class MaterialsApi {
  // Resource Management - Materials
  /** Archived material is excluded unless `includeArchived` — the board must
   *  never see a retired device, the Materialverwaltung shows it on request. */
  async getAllMaterials(options?: { includeArchived?: boolean }): Promise<ApiMaterialResource[]> {
    const query = options?.includeArchived ? '?include_archived=true' : ''
    return httpRequest<ApiMaterialResource[]>(`/api/materials/${query}`)
  }

  async getMaterialById(id: string): Promise<ApiMaterialResource> {
    return httpRequest<ApiMaterialResource>(`/api/materials/${id}`)
  }

  async createMaterialResource(data: ApiMaterialCreate): Promise<ApiMaterialResource> {
    return httpRequest<ApiMaterialResource>('/api/materials/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateMaterialResource(id: string, data: ApiMaterialUpdate): Promise<ApiMaterialResource> {
    return httpRequest<ApiMaterialResource>(`/api/materials/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  /** Take a device out of the inventory, reversibly. Broadcast as a WS `delete`. */
  async archiveMaterialResource(id: string): Promise<ApiMaterialResource> {
    return httpRequest<ApiMaterialResource>(`/api/materials/${id}/archive`, {
      method: 'POST',
    })
  }

  /** «Zurückholen» — bring an archived device back. Broadcast as a WS `create`. */
  async restoreMaterialResource(id: string): Promise<ApiMaterialResource> {
    return httpRequest<ApiMaterialResource>(`/api/materials/${id}/restore`, {
      method: 'POST',
    })
  }

  /**
   * Archives by default; `permanent` purges the row.
   *
   * The purge is refused with 409 (German `detail` on the ApiError) unless the
   * device is already archived AND never stood on a live, non-training Einsatz.
   * A test entry used only on a drill is therefore purgeable.
   */
  async deleteMaterialResource(id: string, options?: { permanent?: boolean }): Promise<void> {
    const query = options?.permanent ? '?permanent=true' : ''
    return httpRequest<void>(`/api/materials/${id}${query}`, {
      method: 'DELETE',
    })
  }

  async updateMaterialCategorySortOrder(data: BulkCategorySortOrderUpdate): Promise<{ status: string; updated_categories: number }> {
    return httpRequest<{ status: string; updated_categories: number }>('/api/materials/categories/sort-order', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Material Groups
  async getMaterialGroups(): Promise<ApiMaterialGroup[]> {
    return httpRequest<ApiMaterialGroup[]>('/api/material-groups/')
  }

  async createMaterialGroup(data: { name: string; description?: string; location?: string; location_sort_order?: number; material_ids?: string[] }): Promise<ApiMaterialGroup> {
    return httpRequest<ApiMaterialGroup>('/api/material-groups/', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateMaterialGroup(id: string, data: { name?: string; description?: string; location?: string; location_sort_order?: number; material_ids?: string[] }): Promise<ApiMaterialGroup> {
    return httpRequest<ApiMaterialGroup>(`/api/material-groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  async deleteMaterialGroup(id: string): Promise<void> {
    return httpRequest<void>(`/api/material-groups/${id}`, {
      method: 'DELETE',
    })
  }
}

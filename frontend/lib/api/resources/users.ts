/**
 * User management (admin only).
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type { ApiUser, ApiUserCreate, ApiUserUpdate } from '../types'

export class UsersApi {
  // User Management (Admin only)
  async getUsers(): Promise<ApiUser[]> {
    return httpRequest<ApiUser[]>('/api/users/')
  }

  async getUser(userId: string): Promise<ApiUser> {
    return httpRequest<ApiUser>(`/api/users/${userId}`)
  }

  async createUser(user: ApiUserCreate): Promise<ApiUser> {
    return httpRequest<ApiUser>('/api/users/', {
      method: 'POST',
      body: JSON.stringify(user),
    })
  }

  async updateUser(userId: string, user: ApiUserUpdate): Promise<ApiUser> {
    return httpRequest<ApiUser>(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(user),
    })
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<void> {
    return httpRequest<void>(`/api/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    })
  }

  async deleteUser(userId: string, permanent: boolean = false): Promise<void> {
    const url = permanent ? `/api/users/${userId}?permanent=true` : `/api/users/${userId}`
    return httpRequest<void>(url, {
      method: 'DELETE',
    })
  }
}

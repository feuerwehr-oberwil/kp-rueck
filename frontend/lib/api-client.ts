/**
 * API Client for KP Rück Backend
 * Handles all HTTP requests to the FastAPI backend
 *
 * `apiClient` is ONE object with every endpoint method on it – about 40 test
 * files mock `@/lib/api-client` by method name, and `api-client.contract.test.ts`
 * pins the list. The methods live per resource in `lib/api/resources/*.ts`
 * (one class each) and are mixed into the client's prototype below; the
 * transport (retries, toasts, session expiry) is `lib/api/http.ts`, the types
 * are `lib/api/types/`.
 */

// Re-export every API type so existing consumers (`import { type ApiX } from '@/lib/api-client'`)
// keep working unchanged. Source definitions live in lib/api/types/ split by domain.
export * from './api/types'
// The tab-wide REST reachability lives with the transport; still importable from here.
export { getRestReachable, onRestReachableChange } from './api/http'
export type {
  ApiViewerIncident,
  ApiViewerPersonnel,
  ApiViewerMaterial,
  ApiViewerAssignment,
  ApiViewerSpecialFunction,
  ApiViewerGroupAssignment,
  ApiViewerGroup,
  ApiViewerData,
} from './api/resources/viewer'
export type { PhotoUploadProgress } from './api/resources/upload'
export { FeldUnlockError, type FeldUnlockFailure } from './api/resources/feld'

import { SettingsApi } from './api/resources/settings'
import { EventsApi } from './api/resources/events'
import { IncidentsApi } from './api/resources/incidents'
import { GroupsApi } from './api/resources/groups'
import { JournalApi } from './api/resources/journal'
import { AssignmentsApi } from './api/resources/assignments'
import { PersonnelApi } from './api/resources/personnel'
import { VehiclesApi } from './api/resources/vehicles'
import { MaterialsApi } from './api/resources/materials'
import { RekoApi } from './api/resources/reko'
import { SyncApi } from './api/resources/sync'
import { ExportsApi } from './api/resources/exports'
import { TrainingApi } from './api/resources/training'
import { DiveraApi } from './api/resources/divera'
import { TrackingApi } from './api/resources/tracking'
import { FeldApi } from './api/resources/feld'
import { RapportApi } from './api/resources/rapport'
import { ViewerApi } from './api/resources/viewer'
import { PrintApi } from './api/resources/print'
import { UsersApi } from './api/resources/users'
import { SystemApi } from './api/resources/system'

const RESOURCES = [
  SettingsApi,
  EventsApi,
  IncidentsApi,
  GroupsApi,
  JournalApi,
  AssignmentsApi,
  PersonnelApi,
  VehiclesApi,
  MaterialsApi,
  RekoApi,
  SyncApi,
  ExportsApi,
  TrainingApi,
  DiveraApi,
  TrackingApi,
  FeldApi,
  RapportApi,
  ViewerApi,
  PrintApi,
  UsersApi,
  SystemApi,
] as const

type ApiClient = SettingsApi &
  EventsApi &
  IncidentsApi &
  GroupsApi &
  JournalApi &
  AssignmentsApi &
  PersonnelApi &
  VehiclesApi &
  MaterialsApi &
  RekoApi &
  SyncApi &
  ExportsApi &
  TrainingApi &
  DiveraApi &
  TrackingApi &
  FeldApi &
  RapportApi &
  ViewerApi &
  PrintApi &
  UsersApi &
  SystemApi

/**
 * One prototype carrying every resource's methods, copied with their own
 * descriptors (non-enumerable, like class methods), so `this` inside a method
 * is the client and `vi.spyOn(apiClient, …)` replaces what callers reach.
 * Two resources declaring the same name is a mistake – fail at load, not by
 * silently letting the later one win.
 */
function createApiClient(): ApiClient {
  class Client {}
  for (const resource of RESOURCES) {
    for (const name of Object.getOwnPropertyNames(resource.prototype)) {
      if (name === 'constructor') continue
      if (Object.prototype.hasOwnProperty.call(Client.prototype, name)) {
        throw new Error(`apiClient: «${name}» is declared by two resources`)
      }
      Object.defineProperty(
        Client.prototype,
        name,
        Object.getOwnPropertyDescriptor(resource.prototype, name)!,
      )
    }
  }
  return new Client() as ApiClient
}

export const apiClient = createApiClient()

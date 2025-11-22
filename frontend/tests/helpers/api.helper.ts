/**
 * API Helper for E2E Tests
 * Provides utilities for setting up test data via backend API
 */

export interface TestUser {
  username: string;
  password: string;
  role: 'editor' | 'viewer';
}

export interface TestEvent {
  id?: string;
  name: string;
  training_flag: boolean;
  auto_attach_divera?: boolean;
}

export interface TestIncident {
  id?: string;
  event_id: string;
  location: string;
  address?: string;
  criticality?: 'normal' | 'critical';
  type?: string;
  status?: 'new' | 'in_progress' | 'done';
}

export class APIHelper {
  private baseURL: string;
  private cookies?: string;

  constructor(baseURL: string = 'http://localhost:8000', cookies?: string) {
    this.baseURL = baseURL;
    this.cookies = cookies;
  }

  /**
   * Set authentication cookies
   */
  setCookies(cookies: string) {
    this.cookies = cookies;
  }

  /**
   * Make authenticated API request
   */
  private async request(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': this.cookies || '',
        ...options.headers,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API request failed: ${response.status} ${text}`);
    }

    return response.json();
  }

  // ============================================
  // EVENT MANAGEMENT
  // ============================================

  async createEvent(data: Partial<TestEvent>): Promise<TestEvent> {
    return this.request('/api/events/', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name || `Test Event ${Date.now()}`,
        training_flag: data.training_flag ?? false,
        auto_attach_divera: data.auto_attach_divera ?? false,
      }),
    });
  }

  async getEvents(): Promise<TestEvent[]> {
    return this.request('/api/events/');
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request(`/api/events/${eventId}`, { method: 'DELETE' });
  }

  // ============================================
  // INCIDENT MANAGEMENT
  // ============================================

  async createIncident(data: Partial<TestIncident>): Promise<TestIncident> {
    return this.request('/api/incidents/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getIncidents(eventId?: string): Promise<TestIncident[]> {
    const url = eventId ? `/api/incidents/?event_id=${eventId}` : '/api/incidents/';
    return this.request(url);
  }

  async updateIncident(incidentId: string, data: Partial<TestIncident>): Promise<TestIncident> {
    return this.request(`/api/incidents/${incidentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteIncident(incidentId: string): Promise<void> {
    await this.request(`/api/incidents/${incidentId}`, { method: 'DELETE' });
  }

  // ============================================
  // RESOURCE MANAGEMENT
  // ============================================

  async getPersonnel(eventId?: string): Promise<any[]> {
    const url = eventId ? `/api/personnel/?event_id=${eventId}` : '/api/personnel/';
    return this.request(url);
  }

  async getPersonnelByName(name: string, eventId?: string): Promise<any> {
    const personnel = await this.getPersonnel(eventId);
    return personnel.find((p: any) => p.name === name);
  }

  async getVehicles(eventId?: string): Promise<any[]> {
    const url = eventId ? `/api/vehicles/?event_id=${eventId}` : '/api/vehicles/';
    return this.request(url);
  }

  async getVehicleByName(name: string, eventId?: string): Promise<any> {
    const vehicles = await this.getVehicles(eventId);
    return vehicles.find((v: any) => v.name === name);
  }

  async getMaterials(eventId?: string): Promise<any[]> {
    const url = eventId ? `/api/materials/?event_id=${eventId}` : '/api/materials/';
    return this.request(url);
  }

  async getMaterialByName(name: string, eventId?: string): Promise<any> {
    const materials = await this.getMaterials(eventId);
    return materials.find((m: any) => m.name === name);
  }

  // ============================================
  // RESOURCE ASSIGNMENT
  // ============================================

  async assignPersonnelToIncident(incidentId: string, personnelId: string): Promise<void> {
    await this.request(`/api/incidents/${incidentId}/personnel`, {
      method: 'POST',
      body: JSON.stringify({ personnel_id: personnelId }),
    });
  }

  async assignVehicleToIncident(incidentId: string, vehicleId: string): Promise<void> {
    await this.request(`/api/incidents/${incidentId}/vehicles`, {
      method: 'POST',
      body: JSON.stringify({ vehicle_id: vehicleId }),
    });
  }

  async assignMaterialToIncident(incidentId: string, materialId: string): Promise<void> {
    await this.request(`/api/incidents/${incidentId}/materials`, {
      method: 'POST',
      body: JSON.stringify({ material_id: materialId }),
    });
  }

  /**
   * Create incident with pre-assigned resources
   */
  async createIncidentWithResources(data: {
    event_id: string;
    location: string;
    personnel?: string[];
    vehicles?: string[];
    materials?: string[];
  }): Promise<TestIncident> {
    // Create incident
    const incident = await this.createIncident({
      event_id: data.event_id,
      location: data.location,
      address: data.location,
    });

    // Assign resources
    if (data.personnel) {
      for (const name of data.personnel) {
        const person = await this.getPersonnelByName(name, data.event_id);
        if (person) {
          await this.assignPersonnelToIncident(incident.id!, person.id);
        }
      }
    }

    if (data.vehicles) {
      for (const name of data.vehicles) {
        const vehicle = await this.getVehicleByName(name, data.event_id);
        if (vehicle) {
          await this.assignVehicleToIncident(incident.id!, vehicle.id);
        }
      }
    }

    if (data.materials) {
      for (const name of data.materials) {
        const material = await this.getMaterialByName(name, data.event_id);
        if (material) {
          await this.assignMaterialToIncident(incident.id!, material.id);
        }
      }
    }

    return incident;
  }

  // ============================================
  // SETTINGS
  // ============================================

  async getSetting(key: string): Promise<any> {
    const settings = await this.request('/api/settings/');
    return settings.find((s: any) => s.key === key);
  }

  async updateSetting(key: string, value: string): Promise<void> {
    await this.request('/api/settings/', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    });
  }

  // ============================================
  // CLEANUP
  // ============================================

  /**
   * Delete all test data (use with caution!)
   */
  async cleanupTestData(eventId?: string): Promise<void> {
    if (eventId) {
      // Delete all incidents for this event
      const incidents = await this.getIncidents(eventId);
      for (const incident of incidents) {
        await this.deleteIncident(incident.id!);
      }
      // Delete the event
      await this.deleteEvent(eventId);
    }
  }
}

/**
 * API client for ProviderCard backend
 */
import axios, { AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  npi: string;
}

export interface Practitioner {
  id: string;
  fhir_id: string;
  npi?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  suffix?: string;
  gender?: string;
  email: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  status: string;
  completeness: number;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface AcceptedInsurance {
  name: string;
  plan_type?: string;
}

export interface PractitionerRole {
  id: string;
  fhir_id: string;
  practitioner_id: string;
  specialty_code?: string;
  specialty_display?: string;
  practice_name?: string;
  practice_address_line1?: string;
  practice_address_line2?: string;
  practice_city?: string;
  practice_state?: string;
  practice_postal_code?: string;
  license_state?: string;
  license_number?: string;
  license_expiration?: string;
  accepted_insurances?: AcceptedInsurance[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  practitioner_id: string;
  target_system: string;
  target_url?: string;
  sync_type: string;
  event_type: string;
  status: string;
  response_status?: number;
  error_message?: string;
  duration_ms?: number;
  created_at: string;
}

// Auth API
export const login = async (data: LoginRequest): Promise<{ access_token: string }> => {
  const response = await api.post('/auth/login', data);
  return response.data;
};

export const register = async (data: RegisterRequest): Promise<{ access_token: string }> => {
  const response = await api.post('/auth/register', data);
  return response.data;
};

// Practitioner API
export const getPractitioner = async (): Promise<Practitioner> => {
  const response = await api.get('/api/practitioners/me');
  return response.data;
};

export const updatePractitioner = async (data: Partial<Practitioner>): Promise<Practitioner> => {
  const response = await api.put('/api/practitioners/me', data);
  return response.data;
};

// PractitionerRole API
export const getPractitionerRoles = async (): Promise<PractitionerRole[]> => {
  const response = await api.get('/api/practitioner-roles');
  return response.data;
};

export const createPractitionerRole = async (data: Partial<PractitionerRole>): Promise<PractitionerRole> => {
  const response = await api.post('/api/practitioner-roles', data);
  return response.data;
};

export const updatePractitionerRole = async (
  id: string,
  data: Partial<PractitionerRole>
): Promise<PractitionerRole> => {
  const response = await api.put(`/api/practitioner-roles/${id}`, data);
  return response.data;
};

// Sync API
export const triggerSync = async (target_systems: string[] = ['payer', 'state_board']): Promise<SyncLog[]> => {
  const response = await api.post('/api/sync', { target_systems });
  return response.data;
};

export const getSyncLogs = async (limit: number = 50): Promise<SyncLog[]> => {
  const response = await api.get('/api/sync-logs', { params: { limit } });
  return response.data;
};

// Demo Dashboard API
export interface Integration {
  id: string;
  name: string;
  type: string;
  status: string;
  last_sync: string | null;
  sync_frequency: string;
  data_shared: string[];
  logo_url: string | null;
}

export interface Discrepancy {
  field: string;
  nppes_value: string;
  providercard_value: string;
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
}

export interface NPPESComparison {
  match_score: number;
  total_discrepancies: number;
  discrepancies: Discrepancy[];
  high_severity_count: number;
  medium_severity_count: number;
  low_severity_count: number;
  nppes_data: any;
  providercard_data: any;
  comparison_timestamp: string;
}

export const getIntegrations = async (): Promise<Integration[]> => {
  const response = await api.get('/api/demo/integrations');
  return response.data;
};

export const compareWithNPPES = async (): Promise<NPPESComparison> => {
  const response = await api.get('/api/demo/nppes-comparison');
  return response.data;
};

export const exportFHIRBundle = async (): Promise<any> => {
  const response = await api.get('/api/demo/export-fhir-bundle');
  return response.data;
};

export default api;

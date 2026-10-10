import { apiRequest } from './api'

/** Client for /api/v1/staff/admin/ (generic staff administration). */

export type AdminFieldType = 'text' | 'longtext' | 'boolean' | 'integer' | 'decimal' | 'choice' | 'json' | 'datetime' | 'ref' | 'secret'
export type AdminField = {
  name: string; label: string; type: AdminFieldType; editable: boolean; required: boolean; nullable: boolean
  choices: string[] | null; help: string | null; max_length: number | null; decimal_places: number | null; min: number | null
}
export type AdminResourceSummary = { key: string; label: string; group: string; description: string; can_manage: boolean }
export type AdminMeta = {
  key: string; label: string; group: string; description: string; pk: 'uuid' | 'bigint'; fields: AdminField[]; list: string[]; filters: string[]
  searchable: boolean; can_manage: boolean; can_create: boolean; actions: { name: string; label: string; confirm: string | null }[]
}
export type AdminRecord = Record<string, unknown> & { id: string | number }

export const listAdminResources = () => apiRequest<AdminResourceSummary[]>('/staff/admin/')

export const listAdminRecords = (resource: string, params: Record<string, string>) =>
  apiRequest<{ meta: AdminMeta; count: number; next: string | null; previous: string | null; results: AdminRecord[] }>(`/staff/admin/${resource}/`, { params })

export const getAdminRecord = (resource: string, id: string) => apiRequest<{ meta: AdminMeta; record: AdminRecord }>(`/staff/admin/${resource}/${id}/`)

export const getAdminOptions = (resource: string, field: string) => apiRequest<{ value: string; label: string }[]>(`/staff/admin/${resource}/options/${field}/`)

export const createAdminRecord = (resource: string, body: Record<string, unknown>) => apiRequest<AdminRecord>(`/staff/admin/${resource}/`, { method: 'POST', body })

export const updateAdminRecord = (resource: string, id: string, body: Record<string, unknown>) => apiRequest<AdminRecord>(`/staff/admin/${resource}/${id}/`, { method: 'PATCH', body })

export const runAdminAction = (resource: string, id: string, action: string) => apiRequest<AdminRecord>(`/staff/admin/${resource}/${id}/actions/${action}/`, { method: 'POST', body: {} })

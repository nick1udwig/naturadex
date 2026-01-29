import type { CreateEntryResponse, EntryDetail, EntrySummary, Health, Settings } from './types'

const API_BASE = import.meta.env.VITE_API_BASE ?? ''

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options)
  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const apiClient = {
  health: () => api<Health>('/api/health'),
  getSettings: () => api<Settings>('/api/settings'),
  updateSettings: (payload: Settings) =>
    api<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  listEntries: () => api<EntrySummary[]>('/api/entries'),
  listPublicEntries: () => api<EntrySummary[]>('/api/public/entries'),
  getEntry: (id: string) => api<EntryDetail>(`/api/entries/${id}`),
  getSharedEntry: (token: string) => api<EntryDetail>(`/api/share/${token}`),
  createEntry: (formData: FormData) =>
    api<CreateEntryResponse>('/api/entries', {
      method: 'POST',
      body: formData,
    }),
  toggleShare: (id: string, enable: boolean) =>
    api<EntryDetail>(`/api/entries/${id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable }),
    }),
  softDelete: (id: string) =>
    api<{ status: string }>(`/api/entries/${id}/delete`, { method: 'POST' }),
  restoreEntry: (id: string) =>
    api<{ status: string }>(`/api/entries/${id}/restore`, { method: 'POST' }),
}

export type EntrySummary = {
  id: string
  created_at: string
  image_url: string
  label: string
  description: string
  confidence?: number | null
  tags: string[]
  shared: boolean
}

export type EntryDetail = EntrySummary & {
  share_url?: string | null
}

export type Settings = {
  is_public: boolean
}

export type Health = {
  status: string
  model: string
}

export type CreateEntryResponse = {
  entry: EntryDetail
}

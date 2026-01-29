CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entries (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  image_path TEXT NOT NULL,
  image_mime TEXT NOT NULL,
  image_width INTEGER,
  image_height INTEGER,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  tags TEXT[] NOT NULL DEFAULT '{}',
  raw_json JSONB,
  share_token TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_deleted_at ON entries (deleted_at);
CREATE INDEX IF NOT EXISTS idx_entries_share_token ON entries (share_token);

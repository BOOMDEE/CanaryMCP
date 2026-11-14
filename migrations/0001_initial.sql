PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  write_token_hash TEXT NOT NULL UNIQUE,
  read_token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_latest (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('location', 'battery', 'usage', 'accessibility')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (device_id, category)
);

CREATE INDEX IF NOT EXISTS idx_context_expiry ON context_latest(expires_at);
CREATE INDEX IF NOT EXISTS idx_context_device_capture ON context_latest(device_id, captured_at DESC);

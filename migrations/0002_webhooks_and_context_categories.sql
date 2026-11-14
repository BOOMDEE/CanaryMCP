PRAGMA foreign_keys = ON;

ALTER TABLE context_latest RENAME TO context_latest_v1;

CREATE TABLE context_latest (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'location', 'battery', 'usage', 'accessibility', 'device', 'network', 'storage'
  )),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  captured_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (device_id, category)
);

INSERT INTO context_latest (device_id, category, payload_json, captured_at, expires_at)
SELECT device_id, category, payload_json, captured_at, expires_at
FROM context_latest_v1;

DROP TABLE context_latest_v1;
CREATE INDEX IF NOT EXISTS idx_context_expiry ON context_latest(expires_at);
CREATE INDEX IF NOT EXISTS idx_context_device_capture ON context_latest(device_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS device_webhooks (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  encrypted_config TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0 CHECK (success IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_device_time
  ON webhook_deliveries(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_rate_limits (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  window_seconds INTEGER NOT NULL,
  bucket_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (device_id, window_seconds, bucket_start)
);

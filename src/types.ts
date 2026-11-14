export const CONTEXT_CATEGORIES = [
  "location",
  "battery",
  "usage",
  "accessibility",
  "device",
  "network",
  "storage",
] as const;

export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

export interface Env {
  DB: D1Database;
  PAIRING_SECRET: string;
  WEBHOOK_ENCRYPTION_KEY?: string;
}

export interface DeviceRecord {
  id: string;
  label: string;
  created_at: string;
  last_seen_at: string;
}

export interface ContextRecord {
  category: ContextCategory;
  payload_json: string;
  captured_at: string;
  expires_at: string;
}

export interface WebhookRecord {
  encrypted_config: string;
  enabled: number;
  updated_at: string;
}
